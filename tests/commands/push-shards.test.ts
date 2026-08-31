import { describe, expect, it, vi } from 'vitest';
import {
  executePush,
  formatPushSuccess,
  type IngestBody,
} from '../../src/commands/push.js';
import type { DiffOutput, TestedConfig } from '../../src/schemas.js';
import type { GitContext } from '../../src/git.js';

function makeDiff(): DiffOutput {
  return {
    schemaVersion: 1,
    base: 'main',
    head: 'abc1234deadbeef',
    patch: { executable: 10, covered: 8, pct: 80 },
    project: { executable: 100, covered: 70, pct: 70, delta: null },
    files: [],
    ignored: [],
  };
}

function makeConfig(): TestedConfig {
  return {
    ignores: [],
    coverage: { format: 'istanbul-json', path: 'coverage/coverage-final.json' },
    base: 'origin/main',
    testRunner: null,
  };
}

function mockGitCtx(): GitContext {
  return {
    git: {
      raw: async (args: string[]) => {
        if (args[0] === 'remote') return 'git@github.com:acme/widgets.git\n';
        if (args[0] === 'config') return 'jane\n';
        return '\n';
      },
      revparse: async (args: string[]) => {
        if (args[0] === 'HEAD') return 'abc1234deadbeef\n';
        if (args[0] === '--abbrev-ref') return 'feat/coverage\n';
        return '\n';
      },
    } as unknown as GitContext['git'],
    repoRoot: '/repo',
  };
}

async function pushShard(
  cli: Parameters<typeof executePush>[0],
  capture: { body?: IngestBody },
) {
  const computeDiffFn = vi.fn(async () => makeDiff());
  const fetchFn: typeof fetch = async (_url, init) => {
    capture.body = JSON.parse(String(init?.body)) as IngestBody;
    return new Response(
      JSON.stringify({ shareUrl: 'https://app.tested.dev/s/shard' }),
      { status: 200 },
    );
  };
  const result = await executePush(cli, {
    cwd: '/repo',
    env: {},
    computeDiffFn: computeDiffFn as unknown as typeof import('../../src/core/computeDiff.js').computeDiff,
    fetchFn,
    openRepoFn: async () => mockGitCtx(),
    loadConfigFn: async () => makeConfig(),
    onProgress: () => {},
  });
  return { result, computeDiffFn };
}

describe('tested push — shard handshake', () => {
  it('does not conclude the gate on shard 1 of 2', async () => {
    const capture: { body?: IngestBody } = {};
    const { result } = await pushShard(
      { json: true, token: 't', pr: '9', parts: '2', part: '1', runId: 'run-1', shard: 'node' },
      capture,
    );
    expect(result.exitCode).toBe(0);
    expect(result.complete).toBe(false);
    expect(capture.body?.coverageMerge).toEqual({
      complete: false,
      totalParts: 2,
      part: 1,
      runId: 'run-1',
      shard: 'node',
    });
    const json = JSON.parse(result.stdout) as { complete: boolean; part: number };
    expect(json.complete).toBe(false);
    expect(json.part).toBe(1);
    expect(result.stdout).not.toMatch(/"overall"\s*:\s*"pass"/);
  });

  it('concludes on the last part', async () => {
    const capture: { body?: IngestBody } = {};
    const { result } = await pushShard(
      { json: true, token: 't', pr: '9', parts: '2', part: '2' },
      capture,
    );
    expect(result.exitCode).toBe(0);
    expect(result.complete).toBe(true);
    expect(capture.body?.coverageMerge?.complete).toBe(true);
    expect(capture.body?.coverageMerge?.part).toBe(2);
  });

  it('--incomplete wins even on the last part', async () => {
    const capture: { body?: IngestBody } = {};
    const { result } = await pushShard(
      { json: false, token: 't', pr: '9', parts: '2', part: '2', incomplete: true },
      capture,
    );
    expect(result.complete).toBe(false);
    expect(capture.body?.coverageMerge?.complete).toBe(false);
    expect(result.stdout).toMatch(/incomplete/);
    expect(result.stdout).not.toMatch(/^✓ shared /);
  });

  it('--complete handshake without local coverage omits diff', async () => {
    const capture: { body?: IngestBody } = {};
    const { result, computeDiffFn } = await pushShard(
      { json: true, token: 't', pr: '9', complete: true },
      capture,
    );
    expect(result.exitCode).toBe(0);
    expect(result.complete).toBe(true);
    expect(computeDiffFn).not.toHaveBeenCalled();
    expect(capture.body?.diff).toBeUndefined();
    expect(capture.body?.coverageMerge).toEqual({ complete: true });
  });

  it('default push still concludes (backward compatible)', async () => {
    const capture: { body?: IngestBody } = {};
    const { result, computeDiffFn } = await pushShard(
      { json: false, token: 't', pr: '9' },
      capture,
    );
    expect(result.complete).toBe(true);
    expect(computeDiffFn).toHaveBeenCalledOnce();
    expect(capture.body?.coverageMerge).toEqual({ complete: true });
    expect(capture.body?.diff).toBeDefined();
  });

  it('human incomplete output is not a passing share/gate line', () => {
    const { stdout } = formatPushSuccess(
      { shareUrl: 'https://app.tested.dev/s/x' },
      false,
      { complete: false, part: 1, totalParts: 3 },
    );
    expect(stdout).toMatch(/incomplete/);
    expect(stdout).toMatch(/pending/);
    expect(stdout).not.toMatch(/✓ shared /);
  });
});
