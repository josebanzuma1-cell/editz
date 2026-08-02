'use client';

import type { CompileNote, ExecutionDecision, MediaInput } from '@editz/engine-core';
import { formatBytes, formatDuration } from '@/lib/format';
import { t, tDynamic } from '@/lib/copy';

/**
 * Notes worth a user's attention. The rest — `encoder-options-dropped`,
 * `vp9-crf-needs-zero-bitrate` — are the compiler talking to its own logs about
 * flags nobody outside this repo has heard of.
 */
const USER_FACING = new Set<CompileNote['code']>([
  'cut-is-keyframe-aligned',
  'container-forces-video-reencode',
  'container-forces-audio-reencode',
  'codec-not-valid-in-container',
  'filter-forces-reencode',
  'dimensions-rounded-to-even',
  'crop-clamped-to-frame',
  'buffers-whole-file',
]);

/** A note's own fields are its message placeholders. */
function noteValues(note: CompileNote): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(note)) {
    if (key === 'code') continue;
    values[key] = Array.isArray(value) ? value.join(', ') : (value as string | number);
  }
  return values;
}

/**
 * The data meter.
 *
 * This is the signature element (§10) and the entire product thesis rendered
 * as an instrument: where the work is happening, and what it will cost in
 * bandwidth, stated before the user commits rather than after. It is not a
 * badge in a corner. It sits above the controls, it is the widest thing on the
 * page, and it is the first thing that changes when you choose a file.
 *
 * The honesty is the point. "0 MB uploaded" is only worth printing if the
 * number is real, which is why it comes from `decideExecution` — the same
 * function the runner will use — and not from a marketing string.
 */
export function DataMeter({
  input,
  decision,
  estimatedOutput,
  notes = [],
  reencode = null,
  problem = null,
}: {
  input: MediaInput | null;
  decision: ExecutionDecision | null;
  estimatedOutput: number | null;
  notes?: readonly CompileNote[];
  reencode?: boolean | null;
  problem?: { code: string; detail?: Record<string, string | number> } | null;
}) {
  const onDevice = decision?.mode === 'client';
  const uploadBytes = decision?.uploadBytes ?? 0;

  return (
    <section
      data-surface="ink"
      aria-label={t('meter.title')}
      className="overflow-hidden rounded-lg border border-hairline"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-5 py-4">
        <span
          aria-hidden
          className={
            decision === null
              ? 'size-2.5 rounded-full bg-text-on-ink-faint'
              : onDevice
                ? 'size-2.5 rounded-full bg-signal'
                : 'size-2.5 rounded-full bg-warn'
          }
        />
        <span className="font-display text-lg font-semibold tracking-tight text-text-on-ink">
          {decision === null
            ? t('meter.title')
            : onDevice
              ? t('meter.onDevice')
              : t('meter.uploading')}
        </span>
        <span className="ml-auto text-readout tabular-nums text-text-on-ink-muted">
          {decision === null
            ? t('meter.unknown')
            : uploadBytes === 0
              ? t('meter.uploadedNothing')
              : t('meter.willUpload', { size: formatBytes(uploadBytes) })}
        </span>
      </div>

      {/* The bar. Full and quiet when nothing leaves the device; filled with a
          warning colour in proportion to what does. */}
      <div className="h-1 w-full bg-hairline">
        <div
          className={onDevice ? 'h-full w-full bg-signal/40' : 'h-full w-full bg-warn'}
          style={decision === null ? { width: 0 } : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-4">
        <Readout
          label={t('meter.inputLabel')}
          value={input ? formatBytes(input.bytes) : t('meter.unknown')}
        />
        <Readout
          label={t('meter.outputLabel')}
          value={
            estimatedOutput !== null ? `~ ${formatBytes(estimatedOutput)}` : t('meter.unknown')
          }
        />
        <Readout
          label={t('meter.uploadLabel')}
          value={decision ? formatBytes(uploadBytes) : t('meter.unknown')}
          emphasis={decision !== null && uploadBytes === 0}
        />
        <Readout
          label={t('meter.workLabel')}
          value={
            reencode === null
              ? t('meter.unknown')
              : reencode
                ? t('meter.work.reencode')
                : t('meter.work.remux')
          }
        />
      </div>

      <p className="border-t border-hairline px-5 py-4 text-sm leading-relaxed text-text-on-ink-muted">
        {decision === null ? t('meter.noFile') : tDynamic(`meter.reason.${decision.reason}`)}
      </p>

      {problem ? (
        <p
          role="alert"
          className="border-t border-hairline px-5 py-4 text-sm leading-relaxed text-bad"
        >
          {tDynamic(`meter.error.${problem.code}`, problem.detail)}
        </p>
      ) : null}

      {/* Everything the compiler decided that the user would not otherwise
          find out until the file came back wrong. */}
      {notes.filter((note) => USER_FACING.has(note.code)).map((note) => (
        <p
          key={note.code}
          className="flex gap-3 border-t border-hairline px-5 py-3 text-sm leading-relaxed text-text-on-ink-muted"
        >
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
          <span>{tDynamic(`meter.note.${note.code}`, noteValues(note))}</span>
        </p>
      ))}

      {input?.durationSec !== undefined || input?.width !== undefined ? (
        <p className="border-t border-hairline px-5 py-3 text-xs text-text-on-ink-faint">
          {[
            input.name,
            input.width && input.height ? `${input.width}×${input.height}` : null,
            input.durationSec !== undefined ? formatDuration(input.durationSec) : null,
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </p>
      ) : null}
    </section>
  );
}

function Readout({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <span className="label-instrument block text-text-on-ink-faint">{label}</span>
      <span
        className={
          emphasis
            ? 'block text-readout tabular-nums text-signal'
            : 'block text-readout tabular-nums text-text-on-ink'
        }
      >
        {value}
      </span>
    </div>
  );
}
