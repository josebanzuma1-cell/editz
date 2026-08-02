/**
 * Byte formatting for the data meter.
 *
 * Deliberately in MB and GB rather than MiB and GiB: the number has to line up
 * with what a mobile network operator charges for, and no operator has ever
 * sold anyone a mebibyte.
 */
export function formatBytes(bytes: number, locale = 'en'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 MB';

  const units: [number, string, number][] = [
    [1_000_000_000, 'GB', 2],
    [1_000_000, 'MB', bytes < 10_000_000 ? 1 : 0],
    [1_000, 'KB', 0],
  ];

  for (const [size, unit, digits] of units) {
    if (bytes >= size) {
      const value = bytes / size;
      return `${value.toLocaleString(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
      })} ${unit}`;
    }
  }

  return `${bytes} B`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "MP4, MOV, MKV" from a list of MIME types, for the wrong-file-type message. */
export function formatAcceptedTypes(mimes: string[]): string {
  const seen = new Set<string>();
  for (const mime of mimes) {
    const sub = mime.split('/')[1];
    if (!sub) continue;
    const label = sub
      .replace(/^x-/, '')
      .replace('quicktime', 'mov')
      .replace('matroska', 'mkv')
      .replace('msvideo', 'avi')
      .replace('mpeg', 'mp3')
      .replace('jpeg', 'jpg');
    seen.add(label.toUpperCase());
  }
  return [...seen].join(', ');
}
