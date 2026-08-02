'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompileError,
  compile,
  decideExecution,
  kindFromMime,
  readBrowserContext,
  type CompileInput,
  type CompiledJob,
  type ExecutionDecision,
  type MediaInput,
} from '@editz/engine-core';
import {
  ClientRunner,
  ClientRunnerError,
  mergeProbe,
  type CoreLoadProgress,
  type FailureCode,
  type RunProgress,
} from '@editz/engine-client';
import type { AnyToolManifest, ToolCategory } from '@editz/tool-registry/types';
import { Button } from '@editz/ui';
import { DataMeter } from '@/components/meter/data-meter';
import { DropZone } from '@/components/tool/drop-zone';
import { ParamPanel } from '@/components/tool/param-panel';
import { formatAcceptedTypes, formatBytes } from '@/lib/format';
import { outputFilename, saveBlob } from '@/lib/download';
import { t, tDynamic } from '@/lib/copy';
import { probe } from '@/lib/probe';
import { loadTool } from '@/lib/tool-loader';
import { WASM_CEILING_BYTES } from '@/lib/site';

type Params = Record<string, unknown>;
type Status = 'idle' | 'running' | 'done' | 'failed';

/**
 * One runner for the page, not one per render.
 *
 * The core is ~31MB of instantiated wasm; a second instance would double the
 * memory a tab holds for no benefit. Kept at module scope so switching tools
 * client-side reuses the already-loaded engine.
 */
let runner: ClientRunner | null = null;
const getRunner = () => (runner ??= new ClientRunner());

/** The runner will write files under names it controls, not the user's. */
function fsNameFor(file: File, index: number): string {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : 'bin';
  return `input${index}.${ext}`;
}

function toCompileInputs(files: File[], probed: MediaInput | null): CompileInput[] {
  return files.map((file, index) => {
    const base: MediaInput =
      index === 0 && probed
        ? probed
        : {
            name: file.name,
            bytes: file.size,
            mime: file.type,
            kind: kindFromMime(file.type) ?? 'video',
          };
    return { ...base, fsName: fsNameFor(file, index) };
  });
}

/**
 * The one tool shell, for all forty tools.
 *
 * Only plain values cross the server boundary — the manifest itself is
 * imported here, in the browser, by `loadTool`. See `tool-loader.ts` for why.
 *
 * The flow is deliberately ordered: read the file locally, decide where the
 * work happens, compile a command from what the DOM knows, and show all of
 * that *before* the user commits. Only once they press the button does the
 * engine get fetched, the file get inspected properly, and the command get
 * recompiled against what FFmpeg actually found inside it.
 */
export function ToolWorkspace({
  slug,
  category,
  name,
  accepts,
  multiFile,
}: {
  slug: string;
  category: ToolCategory;
  name: string;
  accepts: string[];
  multiFile: boolean;
}) {
  const [tool, setTool] = useState<AnyToolManifest | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [input, setInput] = useState<MediaInput | null>(null);
  const [params, setParams] = useState<Params | null>(null);
  const [typeError, setTypeError] = useState(false);

  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [coreLoad, setCoreLoad] = useState<CoreLoadProgress | null>(null);
  const [failure, setFailure] = useState<FailureCode | null>(null);
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadTool(slug, category).then((manifest) => {
      if (cancelled) return;
      setTool(manifest);
      setParams(manifest.defaults as Params);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, category]);

  useEffect(() => {
    if (files.length === 0) {
      setInput(null);
      return;
    }
    let cancelled = false;
    void probe(files[0]!).then((probed) => {
      if (!cancelled) setInput(probed);
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  // Abandoning a page mid-encode should stop the work, not leave a worker
  // chewing CPU behind a closed tab.
  useEffect(() => () => abort.current?.abort(), []);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  const decision: ExecutionDecision | null = useMemo(() => {
    if (!tool || !input || !params) return null;
    return decideExecution({
      policy: {
        execution: tool.execution,
        ...(tool.serverOnly !== undefined ? { serverOnly: tool.serverOnly } : {}),
        ...(tool.clientCeilingBytes !== undefined
          ? { clientCeilingBytes: tool.clientCeilingBytes }
          : {}),
      },
      inputBytes: totalBytes,
      context: readBrowserContext(WASM_CEILING_BYTES),
      paramsRequireServer: tool.requiresServer?.(input, params) ?? null,
    });
  }, [tool, input, params, totalBytes]);

  const validation = useMemo(
    () => (tool && params ? tool.params.safeParse(params) : null),
    [tool, params],
  );

  const estimate = useMemo(() => {
    if (!tool?.estimateOutput || !input || !validation?.success) return null;
    return tool.estimateOutput(input, validation.data);
  }, [tool, input, validation]);

  /**
   * Compile as settings change.
   *
   * `compile` is pure, so this costs nothing and tells the meter things it
   * could not otherwise know until the file came back wrong: whether the job
   * is a re-encode or a repackage, that a cut will land on a keyframe, that a
   * chosen format cannot carry the source track.
   */
  const compiled = useMemo((): { job: CompiledJob } | { error: CompileError } | null => {
    if (!tool || !input || !validation?.success || files.length === 0) return null;
    const inputs = toCompileInputs(files, input);
    try {
      const ops = tool.buildOps(inputs[0]!, validation.data, inputs);
      if (ops.length === 0) return null;
      return { job: compile(inputs, ops) };
    } catch (error) {
      if (error instanceof CompileError) return { error };
      throw error;
    }
  }, [tool, input, validation, files]);

  const job = compiled && 'job' in compiled ? compiled.job : null;
  const problem =
    compiled && 'error' in compiled
      ? {
          code: compiled.error.code,
          ...(compiled.error.detail ? { detail: compiled.error.detail } : {}),
        }
      : null;

  const canRun =
    tool !== null &&
    input !== null &&
    validation?.success === true &&
    job !== null &&
    problem === null &&
    decision?.mode === 'client' &&
    status !== 'running';

  const run = useCallback(async () => {
    if (!tool || !input || !validation?.success || files.length === 0) return;

    const controller = new AbortController();
    abort.current = controller;
    setStatus('running');
    setFailure(null);
    setResult(null);
    setProgress({ fraction: 0, stage: 'loading-core' });

    const inputs = toCompileInputs(files, input);

    try {
      const outcome = await getRunner().execute({
        files,
        fsNames: inputs.map((entry) => entry.fsName),
        build: (probed) => {
          // Recompile against what FFmpeg found rather than what the DOM
          // guessed. This is where a stream copy becomes possible, and where
          // a silent file stops getting an audio filter it cannot take.
          const merged = mergeProbe(inputs[0]!, probed);
          const withProbe: CompileInput[] = inputs.map((entry, index) =>
            index === 0 ? { ...merged, fsName: entry.fsName } : entry,
          );
          const ops = tool.buildOps(withProbe[0]!, validation.data, withProbe);
          const built = compile(withProbe, ops);
          return {
            job: built,
            ...(built.outputDurationSec !== undefined
              ? { expectedDurationSec: built.outputDurationSec }
              : {}),
          };
        },
        onProgress: setProgress,
        onCoreLoad: setCoreLoad,
        signal: controller.signal,
      });

      const extension = tool.outputExtension(validation.data, input);
      setResult({
        blob: outcome.blob,
        filename: outputFilename(files[0]!.name, slug, extension),
      });
      setStatus('done');
    } catch (error) {
      // FFmpeg's own words never reach the user (§7), but throwing them away
      // entirely makes a failed job impossible to diagnose. The console is
      // the right place for them.
      if (error instanceof ClientRunnerError) {
        console.error(`[editz] ${slug} failed: ${error.code}`, error.logTail.join('\n'));
      } else {
        console.error(`[editz] ${slug} failed`, error);
      }
      setFailure(error instanceof ClientRunnerError ? error.code : 'unknown');
      setStatus('failed');
    } finally {
      abort.current = null;
    }
  }, [tool, input, validation, files, slug]);

  function onFiles(picked: File[]) {
    const acceptable = accepts.length === 0 || picked.every((file) => accepts.includes(file.type));
    setTypeError(!acceptable);
    if (!acceptable) return;
    setFiles(picked);
    setStatus('idle');
    setResult(null);
    setFailure(null);
    setProgress(null);
  }

  const serverOnly = decision !== null && decision.mode === 'server';

  return (
    <div data-surface="ink" className="space-y-6 rounded-xl border border-hairline p-5 sm:p-6">
      <DataMeter
        input={input}
        decision={decision}
        estimatedOutput={estimate}
        notes={job?.notes ?? []}
        reencode={job?.reencode ?? null}
        problem={problem}
        {...(progress ? { progress } : {})}
        {...(coreLoad ? { coreLoad } : {})}
      />

      {files.length === 0 ? (
        <DropZone accept={accepts} multiple={multiFile} onFiles={onFiles} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-on-ink-muted">
            {files.map((file) => file.name).join(', ')}
          </p>
          <Button
            type="button"
            variant="ghost"
            disabled={status === 'running'}
            onClick={() => {
              setFiles([]);
              setStatus('idle');
              setResult(null);
              setFailure(null);
            }}
          >
            {t('tool.changeFile')}
          </Button>
        </div>
      )}

      {typeError ? (
        <p role="alert" className="text-sm text-bad">
          {t('tool.wrongType', { types: formatAcceptedTypes(accepts) })}
        </p>
      ) : null}

      {tool && params && tool.ui.controls.length > 0 ? (
        <section className="space-y-5 border-t border-hairline pt-6">
          <h2 className="label-instrument text-text-on-ink-faint">{t('tool.settings')}</h2>
          <ParamPanel
            tool={tool}
            params={params}
            onChange={setParams}
            durationSec={input?.durationSec}
          />
        </section>
      ) : null}

      <div className="space-y-4 border-t border-hairline pt-6">
        {status === 'done' && result ? (
          <div className="space-y-3">
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => saveBlob(result.blob, result.filename)}
            >
              {t('tool.download', { name: result.filename })}
            </Button>
            <p className="text-sm text-text-on-ink-muted">
              <span className="text-text-on-ink">{t('tool.done')}.</span> {t('tool.doneBody')}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="primary"
              size="lg"
              disabled={!canRun}
              onClick={() => void run()}
              className="w-full sm:w-auto"
            >
              {status === 'running'
                ? tDynamic(`tool.stage.${progress?.stage ?? 'running'}`)
                : name}
            </Button>
            {status === 'running' ? (
              <Button type="button" variant="secondary" onClick={() => abort.current?.abort()}>
                {t('tool.cancel')}
              </Button>
            ) : null}
          </div>
        )}

        {serverOnly ? (
          <p className="text-sm text-text-on-ink-muted">
            <span className="text-text-on-ink">{t('tool.notYetAvailable')}.</span>{' '}
            {t('tool.notYetAvailableBody')}
          </p>
        ) : null}

        {status === 'failed' && failure ? (
          <p role="alert" className="text-sm text-bad">
            {tDynamic(`tool.failure.${failure}`)}
          </p>
        ) : null}

        {validation && !validation.success && files.length > 0 ? (
          <p role="alert" className="text-sm text-bad">
            {/* The manifest's schema type is erased at the registry boundary,
                so the issue list arrives untyped. */}
            {validation.error.issues
              .map((issue: { message: string }) => issue.message)
              .join(' · ')}
          </p>
        ) : null}

        {coreLoad && !coreLoad.fromCache && status === 'running' ? (
          <p className="text-xs leading-relaxed text-warn">
            {t('tool.coreDownload', { size: formatBytes(coreLoad.totalBytes ?? 31_000_000) })}
          </p>
        ) : null}

        <p className="text-xs leading-relaxed text-text-on-ink-faint">{t('tool.retention')}</p>
      </div>
    </div>
  );
}
