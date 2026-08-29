/**
 * Where a job runs, decided once, in one place (§2.3).
 *
 * This is a pure function on purpose. It is called by the tool page to render
 * the data meter *before* the user commits, by the client runner to decide
 * whether to hand off, and by the API to sanity-check what the client claimed.
 * Anything impure here — reading `navigator`, touching a store — would make two
 * of those three impossible.
 *
 * It deliberately does not know about `ToolManifest`; it takes a structural
 * `ExecutionPolicy` that a manifest happens to satisfy. That keeps
 * engine-core free of a dependency on tool-registry, which depends on it.
 */

export type ExecutionMode = 'client' | 'server' | 'auto';

/** Why a job is going to the server. Surfaced to the user, so keep it honest. */
export type ServerReason =
  | 'file-too-large'
  | 'low-device-memory'
  | 'tool-is-server-only'
  | 'params-need-server'
  | 'no-cross-origin-isolation';

/** Why a job is staying on the device. */
export type ClientReason = 'client-capable' | 'tool-is-client-only';

export type ExecutionReason = ServerReason | ClientReason;

export interface ExecutionPolicy {
  execution: ExecutionMode;
  serverOnly?: boolean;
  /** Per-tool override of the global wasm ceiling. */
  clientCeilingBytes?: number;
}

export interface ExecutionContext {
  /** `globalThis.crossOriginIsolated`. Without it there is no SharedArrayBuffer
   *  and therefore no multi-threaded ffmpeg.wasm. */
  crossOriginIsolated: boolean;
  /** `navigator.deviceMemory`, in GB. Undefined on Firefox and Safari, which is
   *  treated as "no evidence of a small device" rather than as a small device. */
  deviceMemoryGb?: number;
  /** Global ceiling, overridable per deployment via env. */
  wasmCeilingBytes?: number;
}

export interface ExecutionDecision {
  mode: 'client' | 'server';
  reason: ExecutionReason;
  /** What this will cost the user in upload. Zero on the client path — this is
   *  the number the data meter exists to show. */
  uploadBytes: number;
}

export interface ExecutionQuery {
  policy: ExecutionPolicy;
  /** Sum of every input file's size. Merge tools upload all of them. */
  inputBytes: number;
  context: ExecutionContext;
  /** The result of `manifest.requiresServer(input, params)`, evaluated by the
   *  caller. Lets a *parameter combination* force the server without this
   *  function needing to know what a parameter is. */
  paramsRequireServer?: ServerReason | null;
}

export const DEFAULT_WASM_CEILING_BYTES = 250 * 1024 * 1024;
/** Below this much RAM we stop trusting the browser with big files. */
export const LOW_MEMORY_GB = 4;
/** ...but only once the file is big enough to matter. */
export const LOW_MEMORY_FILE_BYTES = 80 * 1024 * 1024;

/**
 * Precedence, highest first:
 *
 *   1. The tool says server-only.          → server
 *   2. The chosen parameters need server.  → server
 *   3. The tool says client-only.          → client
 *   4. No cross-origin isolation.          → server
 *   5. Over the wasm ceiling.              → server
 *   6. Small device and a biggish file.    → server
 *   7. Otherwise                           → client
 *
 * 1 and 2 come before the capability checks because they are statements about
 * the work, not about the device: a device that *could* run wasm still cannot
 * run Whisper. 3 comes before the capability checks because a tool declaring
 * `client` (screen recorder, camera recorder) has no server implementation to
 * fall back to — those use MediaRecorder, not wasm, so isolation is irrelevant.
 */
export function decideExecution(query: ExecutionQuery): ExecutionDecision {
  const { policy, inputBytes, context, paramsRequireServer } = query;

  const server = (reason: ServerReason): ExecutionDecision => ({
    mode: 'server',
    reason,
    uploadBytes: inputBytes,
  });
  const client = (reason: ClientReason): ExecutionDecision => ({
    mode: 'client',
    reason,
    uploadBytes: 0,
  });

  if (policy.serverOnly || policy.execution === 'server') return server('tool-is-server-only');
  if (paramsRequireServer) return server(paramsRequireServer);
  if (policy.execution === 'client') return client('tool-is-client-only');

  if (!context.crossOriginIsolated) return server('no-cross-origin-isolation');

  const ceiling = policy.clientCeilingBytes ?? context.wasmCeilingBytes ?? DEFAULT_WASM_CEILING_BYTES;
  if (inputBytes > ceiling) return server('file-too-large');

  const memory = context.deviceMemoryGb;
  if (memory !== undefined && memory < LOW_MEMORY_GB && inputBytes > LOW_MEMORY_FILE_BYTES) {
    return server('low-device-memory');
  }

  return client('client-capable');
}

/** Reads the ambient browser context. The only impure part, kept separate so
 *  `decideExecution` stays testable without a DOM. */
export function readBrowserContext(wasmCeilingBytes?: number): ExecutionContext {
  // Reached for off globalThis rather than named directly.
  //
  // engine-core is runtime-agnostic — it compiles without the DOM lib so it
  // can be shared with the Node worker — so `navigator` is not a name it can
  // refer to. It resolved locally only because @types/node happened to be
  // hoisted into scope, which meant any consumer without @types/node failed
  // to typecheck while this package passed. Structural access has no such
  // dependency. Same treatment as `crossOriginIsolated` below.
  //
  // `deviceMemory` is Chromium-only and absent from lib.dom.d.ts either way.
  const nav = (globalThis as { navigator?: { deviceMemory?: number } }).navigator;

  // engine-core is shared with the Node worker, so it does not pull in the DOM
  // lib. `crossOriginIsolated` has to be reached for structurally.
  const isolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;

  return {
    crossOriginIsolated: typeof isolated === 'boolean' ? isolated : false,
    ...(typeof nav?.deviceMemory === 'number' ? { deviceMemoryGb: nav.deviceMemory } : {}),
    ...(wasmCeilingBytes !== undefined ? { wasmCeilingBytes } : {}),
  };
}
