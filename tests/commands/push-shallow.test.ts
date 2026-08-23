import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { executePush, type IngestBody } from '../../src/commands/push.js';
import type { TestedConfig } from '../../src/schemas.js';

const here = dirname(fileURLToPath(import.meta.url));
const resolveScript = join(here, '../../action/resolve-check-base.sh');

let server = '';
let shallow = '';
let baseSha = '';
let headSha = '';

const configMain: TestedConfig = {
  ignores: [],
  coverage: { format: 'istanbul-json', path: 'coverage/coverage-final.json' },
  base: 'main',
  testRunner: null,
};

function writeCoverage(cwd: string): void {
  const appPath = join(cwd, 'app.ts');
  mkdirSync(join(cwd, 'coverage'), { recursive: true });
  writeFileSync(
    join(cwd, 'coverage/coverage-final.json'),
    JSON.stringify({
      [appPath]: {
        path: appPath,
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
          '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
        },
        fnMap: {},
        branchMap: {},
        s: { '0': 1, '1': 1 },
        f: {},
        b: {},
      },
    }),
  );
  writeFileSync(join(cwd, '.tested.yaml'), 'base: main\n');
}

beforeAll(async () => {
  server = mkdtempSync(join(tmpdir(), 'tested-push-server-'));
  const git = simpleGit({ baseDir: server });
  await git.init(['-b', 'main']);
  await git.addConfig('user.email', 'test@tested.dev');
  await git.addConfig('user.name', 'Test');
  writeFileSync(join(server, 'app.ts'), 'export const a = 1;\n');
  await git.add('.');
  await git.commit('base', { '--no-verify': null });
  baseSha = (await git.revparse(['HEAD'])).trim();
  await git.checkoutLocalBranch('feature');
  writeFileSync(join(server, 'app.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await git.add('.');
  await git.commit('feature', { '--no-verify': null });
  headSha = (await git.revparse(['HEAD'])).trim();

  shallow = mkdtempSync(join(tmpdir(), 'tested-push-shallow-'));
  await simpleGit().clone(server, shallow, ['--depth', '1', '--branch', 'feature']);
  writeCoverage(shallow);
}, 20_000);

afterAll(() => {
  if (server) rmSync(server, { recursive: true, force: true });
  if (shallow) rmSync(shallow, { recursive: true, force: true });
});

function resolveBase(cwd: string, env: Record<string, string>): string {
  const result = spawnSync('bash', [resolveScript], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

describe('tested push on a shallow PR checkout (no local main)', () => {
  it('does not have a local main ref (Actions pull_request layout)', () => {
    const missing = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'main'], {
      cwd: shallow,
      encoding: 'utf8',
    });
    expect(missing.status).not.toBe(0);
    expect(headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('resolves a fetchable origin base when local main is missing and --pr is set', async () => {
    let posted: IngestBody | undefined;
    const result = await executePush(
      { json: false, token: 't', pr: '35', owner: 'acme', name: 'demo' },
      {
        cwd: shallow,
        env: {},
        loadConfigFn: async () => configMain,
        fetchFn: async (_url, init) => {
          posted = JSON.parse(String(init?.body)) as IngestBody;
          return new Response(
            JSON.stringify({ shareUrl: 'https://app.tested.dev/s/35' }),
            { status: 200 },
          );
        },
        onProgress: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toMatch(/git base ref "main" not found/i);
    expect(posted?.pr?.number).toBe(35);
    expect(posted?.diff.head).toBe(headSha);
    expect(posted?.diff.patch.executable).toBeGreaterThan(0);
    const resolved = posted?.diff.base ?? '';
    expect(
      resolved === baseSha ||
        resolved === 'origin/main' ||
        resolved === 'main' ||
        /^[0-9a-f]{40}$/.test(resolved),
    ).toBe(true);
  });

  it('keeps the friendly missing-base error when the PR base cannot be fetched', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'tested-push-noremote-'));
    try {
      const git = simpleGit({ baseDir: isolated });
      await git.init(['-b', 'feature']);
      await git.addConfig('user.email', 'test@tested.dev');
      await git.addConfig('user.name', 'Test');
      writeFileSync(join(isolated, 'app.ts'), 'export const a = 1;\n');
      await git.add('.');
      await git.commit('feature', { '--no-verify': null });
      writeCoverage(isolated);

      const result = await executePush(
        { json: false, token: 't', pr: '35', owner: 'acme', name: 'demo' },
        {
          cwd: isolated,
          env: {},
          loadConfigFn: async () => configMain,
          fetchFn: async () => new Response('{"message":"Not Found"}', { status: 404 }),
          onProgress: () => {},
        },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/git base ref "main" not found/);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('succeeds when --base is the fetched PR base SHA (Action path)', async () => {
    const resolved = resolveBase(shallow, {
      EVENT_NAME: 'pull_request',
      PR_BASE_SHA: baseSha,
      INPUT_BASE: '',
    });
    expect(resolved).toBe(baseSha);
    expect(resolved).not.toBe('main');

    let posted: IngestBody | undefined;
    const result = await executePush(
      {
        json: false,
        token: 't',
        pr: '35',
        owner: 'acme',
        name: 'demo',
        base: resolved,
      },
      {
        cwd: shallow,
        env: {},
        loadConfigFn: async () => configMain,
        fetchFn: async (_url, init) => {
          posted = JSON.parse(String(init?.body)) as IngestBody;
          return new Response(
            JSON.stringify({ shareUrl: 'https://app.tested.dev/s/35' }),
            { status: 200 },
          );
        },
        onProgress: () => {},
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toMatch(/unknown revision|ambiguous argument/i);
    expect(posted?.pr?.number).toBe(35);
    expect(posted?.diff.base).toBe(baseSha);
    expect(posted?.diff.head).toBe(headSha);
    expect(posted?.diff.patch.executable).toBeGreaterThan(0);
  });
});
