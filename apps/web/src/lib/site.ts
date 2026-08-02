export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Ceiling above which a job goes to the server. Overridable per deployment so
 *  the server path can be exercised locally without a 300MB test file. */
export const WASM_CEILING_BYTES = Number(
  process.env.NEXT_PUBLIC_WASM_CEILING_BYTES ?? 250 * 1024 * 1024,
);

export const FREE_FILE_LIMIT_BYTES = 500 * 1024 * 1024;
export const PRO_FILE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;
