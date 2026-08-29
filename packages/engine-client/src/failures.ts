/**
 * What went wrong, as a code.
 *
 * FFmpeg's stderr is not a user-facing error message (§7). "Invalid data found
 * when processing input" tells a developer the file is corrupt and tells
 * everyone else nothing at all. So the log tail is classified here and the UI
 * says something a person can act on.
 *
 * Anything unrecognised stays `unknown` rather than being guessed at. A wrong
 * explanation is worse than an honest "we are not sure", because the user acts
 * on it.
 */

export type FailureCode =
  | 'unsupported-codec'
  | 'corrupt-input'
  | 'out-of-memory'
  | 'no-space'
  | 'cancelled'
  | 'unknown';

interface Signature {
  code: FailureCode;
  patterns: RegExp[];
}

const SIGNATURES: Signature[] = [
  {
    code: 'out-of-memory',
    // The most common real failure in the browser: wasm cannot grow its heap.
    patterns: [
      /cannot enlarge memory/i,
      /out of memory/i,
      /abort\(OOM\)/i,
      /memory access out of bounds/i,
      /Maximum call stack/i,
    ],
  },
  {
    code: 'unsupported-codec',
    patterns: [
      /decoder \(codec .*\) not found/i,
      /unknown decoder/i,
      /unknown encoder/i,
      /encoder .* not found/i,
      /codec not currently supported in container/i,
    ],
  },
  {
    code: 'corrupt-input',
    patterns: [
      /invalid data found when processing input/i,
      /moov atom not found/i,
      /could not find codec parameters/i,
      /end of file/i,
      /invalid argument/i,
    ],
  },
  { code: 'no-space', patterns: [/no space left on device/i, /ENOSPC/] },
];

export function classifyFailure(logTail: readonly string[]): FailureCode {
  const text = logTail.join('\n');
  for (const signature of SIGNATURES) {
    if (signature.patterns.some((pattern) => pattern.test(text))) return signature.code;
  }
  return 'unknown';
}
