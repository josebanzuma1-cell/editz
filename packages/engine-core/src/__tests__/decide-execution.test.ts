import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WASM_CEILING_BYTES,
  decideExecution,
  type ExecutionContext,
  type ExecutionPolicy,
} from '../execution';

const MB = 1024 * 1024;

const capable: ExecutionContext = {
  crossOriginIsolated: true,
  deviceMemoryGb: 8,
};

const auto: ExecutionPolicy = { execution: 'auto' };

describe('decideExecution', () => {
  it('keeps an ordinary file on the device and uploads nothing', () => {
    const d = decideExecution({ policy: auto, inputBytes: 40 * MB, context: capable });
    expect(d).toEqual({ mode: 'client', reason: 'client-capable', uploadBytes: 0 });
  });

  it('sends a file over the wasm ceiling to the server', () => {
    const d = decideExecution({
      policy: auto,
      inputBytes: DEFAULT_WASM_CEILING_BYTES + 1,
      context: capable,
    });
    expect(d.mode).toBe('server');
    expect(d.reason).toBe('file-too-large');
  });

  it('reports the upload cost in bytes when it goes to the server', () => {
    const d = decideExecution({ policy: auto, inputBytes: 400 * MB, context: capable });
    expect(d.uploadBytes).toBe(400 * MB);
  });

  it('honours a per-tool ceiling below the global one', () => {
    const d = decideExecution({
      policy: { execution: 'auto', clientCeilingBytes: 20 * MB },
      inputBytes: 30 * MB,
      context: capable,
    });
    expect(d.reason).toBe('file-too-large');
  });

  it('honours a deployment ceiling from context', () => {
    const d = decideExecution({
      policy: auto,
      inputBytes: 30 * MB,
      context: { ...capable, wasmCeilingBytes: 20 * MB },
    });
    expect(d.reason).toBe('file-too-large');
  });

  describe('device memory', () => {
    it('offloads a biggish file on a small device', () => {
      const d = decideExecution({
        policy: auto,
        inputBytes: 100 * MB,
        context: { crossOriginIsolated: true, deviceMemoryGb: 2 },
      });
      expect(d.reason).toBe('low-device-memory');
    });

    it('keeps a small file on a small device', () => {
      const d = decideExecution({
        policy: auto,
        inputBytes: 20 * MB,
        context: { crossOriginIsolated: true, deviceMemoryGb: 2 },
      });
      expect(d.mode).toBe('client');
    });

    it('treats exactly 4GB as enough', () => {
      const d = decideExecution({
        policy: auto,
        inputBytes: 200 * MB,
        context: { crossOriginIsolated: true, deviceMemoryGb: 4 },
      });
      expect(d.mode).toBe('client');
    });

    it('does not assume a small device when the browser will not say', () => {
      // Firefox and Safari do not implement navigator.deviceMemory. Guessing
      // "small" there would push every Safari user onto the paid path.
      const d = decideExecution({
        policy: auto,
        inputBytes: 100 * MB,
        context: { crossOriginIsolated: true },
      });
      expect(d.mode).toBe('client');
    });
  });

  it('offloads when there is no cross-origin isolation', () => {
    const d = decideExecution({
      policy: auto,
      inputBytes: 1 * MB,
      context: { crossOriginIsolated: false, deviceMemoryGb: 16 },
    });
    expect(d.reason).toBe('no-cross-origin-isolation');
  });

  describe('precedence', () => {
    it('server-only beats every capability check', () => {
      const d = decideExecution({
        policy: { execution: 'auto', serverOnly: true },
        inputBytes: 1,
        context: capable,
      });
      expect(d.reason).toBe('tool-is-server-only');
    });

    it("execution: 'server' is the same statement as serverOnly", () => {
      const d = decideExecution({ policy: { execution: 'server' }, inputBytes: 1, context: capable });
      expect(d.reason).toBe('tool-is-server-only');
    });

    it('a parameter choice can force the server on an otherwise local job', () => {
      const d = decideExecution({
        policy: auto,
        inputBytes: 1 * MB,
        context: capable,
        paramsRequireServer: 'params-need-server',
      });
      expect(d.reason).toBe('params-need-server');
      expect(d.uploadBytes).toBe(1 * MB);
    });

    it('a null paramsRequireServer does not force anything', () => {
      const d = decideExecution({
        policy: auto,
        inputBytes: 1 * MB,
        context: capable,
        paramsRequireServer: null,
      });
      expect(d.mode).toBe('client');
    });

    it("execution: 'client' ignores isolation and size, because there is no server path", () => {
      // Screen and camera recorders use MediaRecorder, not wasm. There is
      // nothing to fall back to and nothing to upload.
      const d = decideExecution({
        policy: { execution: 'client' },
        inputBytes: 4000 * MB,
        context: { crossOriginIsolated: false, deviceMemoryGb: 1 },
      });
      expect(d).toEqual({ mode: 'client', reason: 'tool-is-client-only', uploadBytes: 0 });
    });

    it('server-only still beats client-only if a tool is misconfigured as both', () => {
      const d = decideExecution({
        policy: { execution: 'client', serverOnly: true },
        inputBytes: 1,
        context: capable,
      });
      expect(d.mode).toBe('server');
    });
  });

  it('is pure — the same query always gives the same answer', () => {
    const query = { policy: auto, inputBytes: 123 * MB, context: capable } as const;
    expect(decideExecution(query)).toEqual(decideExecution(query));
  });
});
