/**
 * What the file actually is, read from its first bytes.
 *
 * The client's declared MIME type is a hint (§11). It comes from the browser,
 * which comes from the file extension, which comes from whoever named the
 * file — so it is trivially wrong and trivially lied about. Before FFmpeg is
 * handed anything, the container is identified from the bytes themselves.
 *
 * This is not a security boundary on its own — FFmpeg is the thing parsing
 * untrusted input, and it is sandboxed and capped separately. It is here to
 * reject nonsense early and cheaply, and to stop a `.mp4` that is really a
 * 2GB zip from occupying a worker.
 */

export type DetectedKind = 'video' | 'audio' | 'image' | 'subtitle' | 'unknown';

export interface Detection {
  kind: DetectedKind;
  /** Container as we name it elsewhere: 'mp4', 'webm', 'jpg'. */
  container: string;
}

interface Signature {
  container: string;
  kind: DetectedKind;
  /** Byte offset the pattern starts at. */
  offset: number;
  bytes: readonly number[];
}

const A = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

const SIGNATURES: readonly Signature[] = [
  // ISO base media: the brand sits at offset 4, after the box size.
  { container: 'mp4', kind: 'video', offset: 4, bytes: A('ftyp') },
  { container: 'mkv', kind: 'video', offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // also webm
  { container: 'avi', kind: 'video', offset: 0, bytes: A('RIFF') },
  { container: 'flv', kind: 'video', offset: 0, bytes: A('FLV') },
  { container: 'mpeg', kind: 'video', offset: 0, bytes: [0x00, 0x00, 0x01, 0xba] },

  { container: 'mp3', kind: 'audio', offset: 0, bytes: A('ID3') },
  { container: 'mp3', kind: 'audio', offset: 0, bytes: [0xff, 0xfb] },
  { container: 'flac', kind: 'audio', offset: 0, bytes: A('fLaC') },
  { container: 'ogg', kind: 'audio', offset: 0, bytes: A('OggS') },

  { container: 'jpg', kind: 'image', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { container: 'png', kind: 'image', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  { container: 'gif', kind: 'image', offset: 0, bytes: A('GIF8') },
  { container: 'bmp', kind: 'image', offset: 0, bytes: A('BM') },
  { container: 'tiff', kind: 'image', offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] },
];

function matches(head: Uint8Array, signature: Signature): boolean {
  const end = signature.offset + signature.bytes.length;
  if (head.length < end) return false;
  return signature.bytes.every((byte, index) => head[signature.offset + index] === byte);
}

export function detect(head: Uint8Array): Detection {
  for (const signature of SIGNATURES) {
    if (!matches(head, signature)) continue;

    // RIFF is a wrapper: WAV and AVI share it and differ at offset 8.
    if (signature.container === 'avi' && head.length >= 12) {
      const tag = String.fromCharCode(...head.slice(8, 12));
      if (tag === 'WAVE') return { kind: 'audio', container: 'wav' };
      if (tag === 'WEBP') return { kind: 'image', container: 'webp' };
      if (tag !== 'AVI ') return { kind: 'unknown', container: 'unknown' };
    }

    // Matroska and WebM are the same container; FFmpeg cares, we mostly do not.
    return { kind: signature.kind, container: signature.container };
  }

  return { kind: 'unknown', container: 'unknown' };
}

/** How many bytes `detect` needs. Read only this much off the object store. */
export const HEAD_BYTES = 16;

/**
 * Whether a detected file is plausibly what the tool expects.
 *
 * Deliberately about the *kind*, not the exact container: a tool that accepts
 * video should take an MKV whose extension says `.mp4`, because that file is
 * fine and the user did nothing wrong.
 */
export function isAcceptable(detected: Detection, expected: DetectedKind): boolean {
  if (detected.kind === 'unknown') return false;
  if (expected === 'video') return detected.kind === 'video' || detected.kind === 'image';
  return detected.kind === expected;
}
