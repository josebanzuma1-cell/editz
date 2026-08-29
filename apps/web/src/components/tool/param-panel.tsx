'use client';

// Types only, and from the types module rather than the registry index —
// importing the index would pull every manifest into the client bundle.
import type { AnyToolManifest, ParamControl } from '@editz/tool-registry/types';
import { Field, NumberInput, Segmented, Select, TextInput, Toggle } from '@editz/ui';
import { formatDuration } from '@/lib/format';

type Params = Record<string, unknown>;

/**
 * Renders a tool's controls from its manifest.
 *
 * There is one of these for all forty tools. A tool that needs a control this
 * cannot render needs a new `ParamControl` kind in the registry types — not a
 * bespoke panel, and definitely not its own page.
 */
export function ParamPanel({
  tool,
  params,
  onChange,
  durationSec,
}: {
  tool: AnyToolManifest;
  params: Params;
  onChange: (next: Params) => void;
  durationSec?: number | undefined;
}) {
  // The manifest's controls are typed against its own parameter type; at the
  // registry boundary that type is erased, so they arrive as ParamControl<any>.
  const controls = tool.ui.controls as ParamControl<Params>[];
  const visible = controls.filter((control) => control.showIf?.(params) ?? true);

  if (visible.length === 0) return null;

  const set = (key: string, value: unknown) => onChange({ ...params, [key]: value });

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {visible.map((control) => {
        const id = `param-${control.key}`;

        switch (control.kind) {
          case 'segmented':
            return (
              <Field key={control.key} label={control.label} hint={control.hint}>
                <Segmented
                  name={control.label}
                  value={String(params[control.key] ?? '')}
                  options={control.options}
                  onChange={(value) =>
                    set(control.key, control.valueType === 'number' ? Number(value) : value)
                  }
                />
              </Field>
            );

          case 'select':
            return (
              <Field key={control.key} label={control.label} hint={control.hint} htmlFor={id}>
                <Select
                  id={id}
                  value={String(params[control.key] ?? '')}
                  options={control.options}
                  onChange={(e) =>
                    set(
                      control.key,
                      control.valueType === 'number' ? Number(e.target.value) : e.target.value,
                    )
                  }
                />
              </Field>
            );

          case 'number':
            return (
              <Field key={control.key} label={control.label} hint={control.hint} htmlFor={id}>
                <NumberInput
                  id={id}
                  value={Number(params[control.key] ?? control.min)}
                  min={control.min}
                  max={control.max}
                  {...(control.step !== undefined ? { step: control.step } : {})}
                  {...(control.unit !== undefined ? { unit: control.unit } : {})}
                  onChange={(value) => set(control.key, value)}
                />
              </Field>
            );

          case 'time':
            return (
              <Field
                key={control.key}
                label={control.label}
                hint={
                  control.hintFromDuration && durationSec !== undefined
                    ? `of ${formatDuration(durationSec)}`
                    : control.hint
                }
                htmlFor={id}
              >
                <NumberInput
                  id={id}
                  value={Number(params[control.key] ?? 0)}
                  min={0}
                  max={durationSec !== undefined ? Math.ceil(durationSec) : 86_400}
                  step={0.1}
                  unit="sec"
                  onChange={(value) => set(control.key, value)}
                />
              </Field>
            );

          case 'toggle':
            return (
              <div key={control.key} className="self-end">
                <Toggle
                  checked={Boolean(params[control.key])}
                  label={control.label}
                  {...(control.hint !== undefined ? { hint: control.hint } : {})}
                  onChange={(checked) => set(control.key, checked)}
                />
              </div>
            );

          case 'text':
            return (
              <Field
                key={control.key}
                label={control.label}
                hint={control.hint}
                htmlFor={id}
              >
                <TextInput
                  id={id}
                  value={String(params[control.key] ?? '')}
                  {...(control.placeholder !== undefined
                    ? { placeholder: control.placeholder }
                    : {})}
                  {...(control.maxLength !== undefined ? { maxLength: control.maxLength } : {})}
                  onChange={(value) => set(control.key, value)}
                />
              </Field>
            );
        }
      })}
    </div>
  );
}
