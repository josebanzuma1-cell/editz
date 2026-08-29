import type { ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-hairline bg-surface', className)}>{children}</div>
  );
}

/** A run of instrument-labelled readouts. Used by the data meter and the
 *  result panel so both read as the same piece of equipment. */
export function Readout({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-label uppercase text-text-on-ink-faint">{label}</span>
      <span
        className={cn(
          'block tabular-nums',
          emphasis ? 'text-readout text-signal' : 'text-readout text-text-on-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
