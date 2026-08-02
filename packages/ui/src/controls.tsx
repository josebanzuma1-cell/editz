'use client';

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from './cn';

/* -------------------------------------------------------------------------- */
/* Focus ring                                                                  */
/* -------------------------------------------------------------------------- */

/** Visible keyboard focus is part of the quality floor (§10), so it is one
 *  constant applied everywhere rather than a decision made per component. */
const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

/* -------------------------------------------------------------------------- */
/* Instrument label                                                            */
/* -------------------------------------------------------------------------- */

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-label font-medium uppercase text-text-on-ink-muted"
    >
      {children}
    </label>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-snug text-text-on-ink-faint">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `primary` is the one action on the screen that uses the accent. There is
   *  never a second primary button in view. */
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'lg';
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-colors duration-(--duration-tap)',
        'disabled:cursor-not-allowed disabled:opacity-40',
        focusRing,
        size === 'lg' ? 'h-12 px-6 text-base' : 'h-9 px-4 text-sm',
        variant === 'primary' && 'bg-signal text-ink hover:bg-signal/90',
        variant === 'secondary' &&
          'border border-hairline-strong bg-surface-raised text-text-on-ink hover:border-text-on-ink-faint',
        variant === 'ghost' && 'text-text-on-ink-muted hover:text-text-on-ink',
        className,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                           */
/* -------------------------------------------------------------------------- */

export interface SegmentOption {
  value: string;
  label: string;
  hint?: string;
}

export function Segmented({
  value,
  options,
  onChange,
  name,
}: {
  value: string;
  options: SegmentOption[];
  onChange: (value: string) => void;
  name: string;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        aria-label={name}
        className="flex flex-wrap gap-1 rounded-md border border-hairline bg-ink p-1"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex-1 rounded-sm px-3 py-1.5 text-sm whitespace-nowrap',
                'transition-colors duration-(--duration-tap)',
                focusRing,
                selected
                  ? 'bg-signal text-ink font-medium'
                  : 'text-text-on-ink-muted hover:text-text-on-ink',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {active?.hint ? (
        <p className="text-xs leading-snug text-text-on-ink-faint">{active.hint}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Select                                                                      */
/* -------------------------------------------------------------------------- */

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  options: SegmentOption[];
};

export function Select({ options, className, ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={cn(
        'h-10 w-full rounded-md border border-hairline-strong bg-ink px-3 text-sm text-text-on-ink',
        focusRing,
        className,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.hint ? `${option.label} — ${option.hint}` : option.label}
        </option>
      ))}
    </select>
  );
}

/* -------------------------------------------------------------------------- */
/* Number input                                                                */
/* -------------------------------------------------------------------------- */

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  id,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  id?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-10 items-center rounded-md border border-hairline-strong bg-ink',
        'focus-within:ring-2 focus-within:ring-signal focus-within:ring-offset-2 focus-within:ring-offset-ink',
      )}
    >
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="w-full bg-transparent px-3 text-sm tabular-nums text-text-on-ink outline-none"
      />
      {unit ? (
        <span className="pr-3 text-label uppercase text-text-on-ink-faint">{unit}</span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toggle                                                                      */
/* -------------------------------------------------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <span className="block text-label font-medium uppercase text-text-on-ink-muted">
          {label}
        </span>
        {hint ? <p className="text-xs leading-snug text-text-on-ink-faint">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-(--duration-tap)',
          focusRing,
          checked ? 'border-signal bg-signal' : 'border-hairline-strong bg-ink',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4.5 rounded-full transition-[left] duration-(--duration-tap)',
            checked ? 'left-[1.4rem] bg-ink' : 'left-0.5 bg-text-on-ink-faint',
          )}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Text input                                                                  */
/* -------------------------------------------------------------------------- */

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-10 w-full rounded-md border border-hairline-strong bg-ink px-3 text-sm',
        'text-text-on-ink placeholder:text-text-on-ink-faint',
        focusRing,
      )}
    />
  );
}
