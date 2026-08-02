'use client';

import { useEffect, useMemo, useState } from 'react';
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
import type { AnyToolManifest, ToolCategory } from '@editz/tool-registry/types';
import { Button } from '@editz/ui';
import { DataMeter } from '@/components/meter/data-meter';
import { DropZone } from '@/components/tool/drop-zone';
import { ParamPanel } from '@/components/tool/param-panel';
import { formatAcceptedTypes } from '@/lib/format';
import { t } from '@/lib/copy';
import { probe } from '@/lib/probe';
import { loadTool } from '@/lib/tool-loader';
import { WASM_CEILING_BYTES } from '@/lib/site';

type Params = Record<string, unknown>;

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
 * Only plain values cross the server boundary — the manifest itself is imported
 * here, in the browser, by `loadTool`. See `tool-loader.ts` for why.
 *
 * Nothing is processed yet. What is real is everything up to that point: the
 * file is read locally, probed for duration and dimensions, `decideExecution`
 * runs against this actual file on this actual device, and `compile` produces
 * the command that would run. The meter reports all of it truthfully — it is
 * the product's central claim, and a mocked one would be worth nothing. The
 * action button is the only thing waiting on the runner.
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
   * Compile as the user changes settings.
   *
   * `compile` is pure, so this costs nothing and tells the meter things it
   * could not otherwise know until the file came back wrong: whether the job is
   * a full re-encode or a repackage, that a cut will land on a keyframe, that
   * a chosen format cannot carry the source track. Getting that on screen
   * *before* the work starts is the same argument as the upload figure.
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
      ? { code: compiled.error.code, ...(compiled.error.detail ? { detail: compiled.error.detail } : {}) }
      : null;

  function onFiles(picked: File[]) {
    const acceptable = accepts.length === 0 || picked.every((file) => accepts.includes(file.type));
    setTypeError(!acceptable);
    if (acceptable) setFiles(picked);
  }

  return (
    <div data-surface="ink" className="space-y-6 rounded-xl border border-hairline p-5 sm:p-6">
      <DataMeter
        input={input}
        decision={decision}
        estimatedOutput={estimate}
        notes={job?.notes ?? []}
        reencode={job?.reencode ?? null}
        problem={problem}
      />

      {files.length === 0 ? (
        <DropZone accept={accepts} multiple={multiFile} onFiles={onFiles} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-on-ink-muted">
            {files.map((file) => file.name).join(', ')}
          </p>
          <Button type="button" variant="ghost" onClick={() => setFiles([])}>
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

      <div className="space-y-3 border-t border-hairline pt-6">
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled
          title={t('tool.notYetAvailable')}
          className="w-full sm:w-auto"
        >
          {name}
        </Button>
        <p className="text-sm text-text-on-ink-muted">
          <span className="text-text-on-ink">{t('tool.notYetAvailable')}.</span>{' '}
          {t('tool.notYetAvailableBody')}
        </p>
        {validation && !validation.success && files.length > 0 ? (
          <p role="alert" className="text-sm text-bad">
            {/* The manifest's schema type is erased at the registry boundary,
                so the issue list arrives untyped. */}
            {validation.error.issues
              .map((issue: { message: string }) => issue.message)
              .join(' Â· ')}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-text-on-ink-faint">{t('tool.retention')}</p>
      </div>
    </div>
  );
}
