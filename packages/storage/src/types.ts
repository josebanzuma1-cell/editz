/**
 * Object storage, behind an interface.
 *
 * Two reasons, and only one of them is testing.
 *
 * The first is §2.4: storage must be Cloudflare R2, specifically because
 * egress is free, and serving processed video back at S3's ~$0.09/GB is what
 * kills businesses in this category. That is a commercial constraint, not a
 * technical one, and commercial constraints change — so the thing that would
 * be expensive to change later is the one worth putting an interface in front
 * of now. Same argument §3 already makes for payment providers.
 *
 * The second is that nobody can develop against a bucket they have no
 * credentials for. A local implementation means the whole §7 lifecycle —
 * presign, upload, enqueue, process, download, expire — runs on a laptop and
 * in CI, rather than only in production where it is expensive to be wrong.
 *
 * Bytes never pass through the API (§7). The web app hands out presigned URLs;
 * the browser and the worker talk to storage directly.
 */

export interface PresignedUpload {
  url: string;
  /** Headers the client must send with the PUT for the signature to hold. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface PresignedDownload {
  url: string;
  expiresAt: Date;
}

export interface ObjectHead {
  bytes: number;
  contentType: string | null;
}

export interface PresignOptions {
  /** Seconds. Uploads get minutes, downloads get an hour (§7). */
  expiresInSeconds?: number;
  contentType?: string;
  /** Refused above this. The signature is not a quota — this is (§8). */
  maxBytes?: number;
}

export interface Storage {
  /**
   * A URL the browser can PUT to directly.
   *
   * Never proxy file bytes through the API: a 2GB upload through a serverless
   * function is billed by the second and capped by the platform.
   */
  presignPut(key: string, options?: PresignOptions): Promise<PresignedUpload>;

  /** A short-lived URL for the finished file. */
  presignGet(key: string, options?: PresignOptions): Promise<PresignedDownload>;

  /** Null when the object is not there. Used to confirm an upload landed. */
  head(key: string): Promise<ObjectHead | null>;

  /**
   * The first bytes of an object.
   *
   * So the worker can identify a file by its magic bytes before downloading
   * all of it — the client's declared MIME type is a hint, not a fact (§11),
   * and a 2GB "video" that is really a zip should be rejected after 16 bytes.
   */
  readHead(key: string, bytes: number): Promise<Uint8Array>;

  /** Pulls an object to local scratch. Worker side. */
  downloadTo(key: string, path: string): Promise<void>;

  /** Pushes a finished file up. Worker side. */
  uploadFrom(key: string, path: string, contentType: string): Promise<void>;

  /**
   * Removes an object.
   *
   * The bucket lifecycle rule is what guarantees the 24-hour promise; this is
   * for the "delete now" button after download, which should not make someone
   * wait a day for something they have already got.
   */
  delete(key: string): Promise<void>;
}

/** Where a job's files live. One prefix per job so a sweep is one delete. */
export const inputKey = (jobId: string, filename: string): string =>
  `jobs/${jobId}/in/${sanitise(filename)}`;

export const outputKey = (jobId: string, filename: string): string =>
  `jobs/${jobId}/out/${sanitise(filename)}`;

/**
 * Strips anything that would let a filename escape its prefix or confuse a
 * signature. Keys are ours to choose; there is no reason to carry a user's
 * emoji, slashes or `..` into one.
 */
export function sanitise(filename: string): string {
  const cleaned = filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // Collapse runs: an emoji is two UTF-16 units and would otherwise leave
    // two underscores behind, so `holiday 🎉 video.mp4` becomes a row of them.
    .replace(/_{2,}/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '');
  return cleaned.slice(0, 120) || 'file';
}
