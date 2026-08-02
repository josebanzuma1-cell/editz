import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { AwsClient } from 'aws4fetch';
import type {
  ObjectHead,
  PresignOptions,
  PresignedDownload,
  PresignedUpload,
  Storage,
} from './types';

/**
 * Cloudflare R2, over the S3 API.
 *
 * R2 rather than S3 for one reason that decides whether this business works:
 * egress is free (§2.4). A video tool serves back roughly what it takes in,
 * and at S3's ~$0.09/GB the bandwidth bill scales with success until it
 * overtakes revenue. Nothing else about this file would differ on S3.
 *
 * `aws4fetch` rather than the AWS SDK: SigV4 presigning is the only thing
 * needed here, and it is a few kilobytes against several megabytes.
 *
 * NOT YET EXERCISED AGAINST A REAL BUCKET — there are no R2 credentials on the
 * machine this was written on. The interface is the point: everything above it
 * is tested against LocalStorage, so what is unverified is this file alone.
 */
export interface R2StorageOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Overrides the derived endpoint. Useful for S3-compatible alternatives. */
  endpoint?: string;
}

export class R2Storage implements Storage {
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(options: R2StorageOptions) {
    this.client = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    const endpoint =
      options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`;
    this.base = `${endpoint.replace(/\/$/, '')}/${options.bucket}`;
  }

  private objectUrl(key: string): string {
    // Each segment encoded separately: the slashes are structure, not content.
    const path = key.split('/').map(encodeURIComponent).join('/');
    return `${this.base}/${path}`;
  }

  private async presign(
    key: string,
    method: 'PUT' | 'GET',
    options?: PresignOptions,
  ): Promise<{ url: string; expiresAt: Date }> {
    const seconds = options?.expiresInSeconds ?? (method === 'PUT' ? 900 : 3600);
    const url = new URL(this.objectUrl(key));
    url.searchParams.set('X-Amz-Expires', String(seconds));

    const signed = await this.client.sign(new Request(url, { method }), {
      aws: { signQuery: true },
    });

    return { url: signed.url, expiresAt: new Date(Date.now() + seconds * 1000) };
  }

  async presignPut(key: string, options?: PresignOptions): Promise<PresignedUpload> {
    const { url, expiresAt } = await this.presign(key, 'PUT', options);
    return {
      url,
      headers: options?.contentType ? { 'content-type': options.contentType } : {},
      expiresAt,
    };
  }

  async presignGet(key: string, options?: PresignOptions): Promise<PresignedDownload> {
    return this.presign(key, 'GET', options);
  }

  async head(key: string): Promise<ObjectHead | null> {
    const response = await this.client.fetch(this.objectUrl(key), { method: 'HEAD' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`r2: HEAD ${key} responded ${response.status}`);
    const length = response.headers.get('content-length');
    return {
      bytes: length ? Number(length) : 0,
      contentType: response.headers.get('content-type'),
    };
  }

  async readHead(key: string, bytes: number): Promise<Uint8Array> {
    // A ranged GET, so identifying a 2GB file costs 16 bytes of transfer.
    const response = await this.client.fetch(this.objectUrl(key), {
      headers: { range: `bytes=0-${bytes - 1}` },
    });
    if (!response.ok) throw new Error(`r2: range GET ${key} responded ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async downloadTo(key: string, path: string): Promise<void> {
    const response = await this.client.fetch(this.objectUrl(key));
    if (!response.ok || !response.body) {
      throw new Error(`r2: GET ${key} responded ${response.status}`);
    }
    await mkdir(dirname(path), { recursive: true });
    // Streamed: the worker handles files far larger than its heap.
    await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  }

  async uploadFrom(key: string, path: string, contentType: string): Promise<void> {
    const info = await stat(path);
    const response = await this.client.fetch(this.objectUrl(key), {
      method: 'PUT',
      body: Readable.toWeb(createReadStream(path)) as ReadableStream,
      headers: { 'content-type': contentType, 'content-length': String(info.size) },
      // Required by undici when the body is a stream.
      duplex: 'half',
    } as RequestInit);
    if (!response.ok) throw new Error(`r2: PUT ${key} responded ${response.status}`);
  }

  async delete(key: string): Promise<void> {
    const response = await this.client.fetch(this.objectUrl(key), { method: 'DELETE' });
    // 404 is success: the object is not there, which is what was asked for.
    if (!response.ok && response.status !== 404) {
      throw new Error(`r2: DELETE ${key} responded ${response.status}`);
    }
  }
}
