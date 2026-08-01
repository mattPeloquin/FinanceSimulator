import { describe, it, expect, vi } from 'vitest';
import { HANDLERS, dispatchWorkerMessage } from '../src/workers/dispatch.js';

describe('worker HANDLERS registry', () => {
  it('resolves the Plan/Lab infrastructure message types', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(
      ['accumulation', 'chunk', 'connect', 'goalSeek', 'run', 'sensitivity'].sort(),
    );
    for (const type of Object.keys(HANDLERS)) {
      expect(typeof HANDLERS[type]).toBe('function');
    }
  });
});

describe('dispatchWorkerMessage', () => {
  it('posts an error for an unknown message type without creating a pool', async () => {
    const post = vi.fn();
    const createPool = vi.fn();

    await dispatchWorkerMessage({ type: 'not-a-real-handler' }, { post, createPool });

    expect(createPool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toEqual({
      type: 'error',
      message: 'Unknown worker message type: not-a-real-handler',
    });
  });

  it('posts an error when type is missing', async () => {
    const post = vi.fn();
    await dispatchWorkerMessage({}, { post, createPool: vi.fn() });
    expect(post.mock.calls[0][0].message).toBe('Unknown worker message type: undefined');
  });

  it('routes master types through a pool and terminates it', async () => {
    const post = vi.fn();
    const terminate = vi.fn();
    const pool = {
      run: vi.fn().mockResolvedValue({}),
      terminate,
    };
    const createPool = vi.fn(() => pool);

    // Stub the run handler so we do not need a full Monte Carlo.
    const original = HANDLERS.run;
    HANDLERS.run = async (ctx) => {
      ctx.post({ type: 'done', result: { ok: true } });
    };

    try {
      await dispatchWorkerMessage(
        { type: 'run', params: {}, numCores: 2, subWorkerPorts: [] },
        { post, createPool },
      );
    } finally {
      HANDLERS.run = original;
    }

    expect(createPool).toHaveBeenCalledWith([], 2);
    expect(post).toHaveBeenCalledWith({ type: 'done', result: { ok: true } });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('posts handler throws as error and still terminates the pool', async () => {
    const post = vi.fn();
    const terminate = vi.fn();
    const createPool = vi.fn(() => ({ terminate }));

    const original = HANDLERS.goalSeek;
    HANDLERS.goalSeek = async () => {
      throw new Error('boom');
    };

    try {
      await dispatchWorkerMessage(
        { type: 'goalSeek', params: {}, goalSeekConfig: {} },
        { post, createPool },
      );
    } finally {
      HANDLERS.goalSeek = original;
    }

    expect(post).toHaveBeenCalledWith({ type: 'error', message: 'boom' });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('does not create a pool for connect or chunk', async () => {
    const post = vi.fn();
    const createPool = vi.fn();

    const originalConnect = HANDLERS.connect;
    const originalChunk = HANDLERS.chunk;
    const connectMock = vi.fn(async () => {});
    const chunkMock = vi.fn(async () => {});
    HANDLERS.connect = connectMock;
    HANDLERS.chunk = chunkMock;

    try {
      await dispatchWorkerMessage(
        { type: 'connect', port: { onmessage: null } },
        { post, createPool },
      );
      await dispatchWorkerMessage(
        { type: 'chunk', params: {}, startIndex: 0, numSimulations: 1 },
        { post, createPool },
      );
    } finally {
      HANDLERS.connect = originalConnect;
      HANDLERS.chunk = originalChunk;
    }

    expect(createPool).not.toHaveBeenCalled();
    expect(connectMock).toHaveBeenCalled();
    expect(chunkMock).toHaveBeenCalled();
  });
});
