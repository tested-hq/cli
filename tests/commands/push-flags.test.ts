import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { invokeCli } from '../helpers/invoke-cli.js';
import { makeFlagRepo } from '../helpers/flag-repo.js';
import {
  buildIngestBody,
  executePush,
  type IngestBody,
} from '../../src/commands/push.js';
import { FlagsJsonMapSchema } from '../../src/schemas.js';

function makeDiffStub() {
  return {
    schemaVersion: 1 as const,
    base: 'main',
    head: 'abc',
    patch: { executable: 10, covered: 9, pct: 90 },
    project: { executable: 12, covered: 11, pct: 91.7, delta: null },
    files: [],
    ignored: [],
  };
}

async function pushFixture(
  repo: string,
  extra: { flag?: string } = {},
): Promise<{ body: IngestBody; exitCode: number; stderr: string }> {
  let body: IngestBody | undefined;
  const fetchFn: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as IngestBody;
    return new Response(
      JSON.stringify({ shareUrl: 'https://app.tested.dev/s/flags' }),
      { status: 200 },
    );
  };
  const result = await executePush(
    {
      json: true,
      token: 't',
      pr: '1',
      owner: 'acme',
      name: 'mono',
      base: 'main',
      ...(extra.flag !== undefined ? { flag: extra.flag } : {}),
    },
    {
      cwd: repo,
      env: {},
      fetchFn,
      onProgress: () => {},
    },
  );
  if (!body) {
    throw new Error(`push did not POST ingest: ${result.stderr || result.stdout}`);
  }
  return { body, exitCode: result.exitCode, stderr: result.stderr };
}

describe('buildIngestBody — flags sibling', () => {
  it('attaches the check --json flags map next to diff', () => {
    const flags = FlagsJsonMapSchema.parse({
      frontend: {
        status: 'fail',
        present: true,
        patchCheck: 'tested.dev / patch / frontend',
        projectCheck: 'tested.dev / project / frontend',
        patch: { pct: 80, threshold: 90, pass: false, executable: 5, covered: 4 },
        project: { pct: 83.3, threshold: 50, pass: true, executable: 6, covered: 5 },
      },
    });
    const diff = makeDiffStub();
    const body = buildIngestBody({
      owner: 'acme',
      name: 'mono',
      baseRef: 'main',
      prNumber: 1,
      prTitle: 't',
      author: 'a',
      headRef: 'h',
      headSha: 's',
      runUrl: null,
      diff,
      flags,
    });
    expect(body.flags).toEqual(flags);
    expect(body.diff).toEqual(diff);
    expect(body.flags?.frontend?.patchCheck).toBe('tested.dev / patch / frontend');
  });
});

describe('tested push — ingest flags (two-package fixture)', () => {
  let both: string;
  let backendOnly: string;

  beforeAll(async () => {
    both = (await makeFlagRepo()).repo;
    backendOnly = (await makeFlagRepo({ includeFrontend: false })).repo;
  });

  afterAll(async () => {
    await rm(both, { recursive: true, force: true });
    await rm(backendOnly, { recursive: true, force: true });
  });

  it('sends flags.frontend with the fail slug tested.dev / patch / frontend', async () => {
    const check = await invokeCli(['check', '--base', 'main', '--json'], { cwd: both });
    expect(check.exitCode).toBe(1);
    const checkJson = JSON.parse(check.stdout) as { flags: IngestBody['flags'] };

    const { body, exitCode } = await pushFixture(both);
    expect(exitCode).toBe(0);
    expect(body.flags).toEqual(checkJson.flags);
    expect(() => FlagsJsonMapSchema.parse(body.flags)).not.toThrow();
    expect(body.flags?.frontend?.status).toBe('fail');
    expect(body.flags?.frontend?.patchCheck).toBe('tested.dev / patch / frontend');
    expect(body.flags?.frontend?.patch.pct).toBe(80);
    expect(body.flags?.frontend?.patch.pass).toBe(false);
    expect(body.flags?.backend?.status).toBe('pass');
  });

  it('sends frontend as missing with executable 0, not backend totals', async () => {
    const { body, exitCode } = await pushFixture(backendOnly);
    expect(exitCode).toBe(0);
    const frontend = body.flags?.frontend;
    const backend = body.flags?.backend;
    expect(frontend?.status).toBe('missing');
    expect(frontend?.present).toBe(false);
    expect(frontend?.patch.executable).toBe(0);
    expect(frontend?.patch.covered).toBe(0);
    expect(frontend?.patch.pct).toBe(0);
    expect(frontend?.project.executable).toBe(0);
    expect(frontend?.patch.pass).toBe(false);
    expect(backend?.status).toBe('pass');
    expect(backend?.patch.executable).toBeGreaterThan(0);
    expect(frontend?.patch.executable).not.toBe(backend?.patch.executable);
    expect(frontend?.project.pct).not.toBe(backend?.project.pct);
  });

  it('scopes --flag backend so ingest omits frontend', async () => {
    const { body, exitCode } = await pushFixture(backendOnly, { flag: 'backend' });
    expect(exitCode).toBe(0);
    expect(Object.keys(body.flags ?? {})).toEqual(['backend']);
    expect(body.flags?.backend?.status).toBe('pass');
    expect(body.flags?.frontend).toBeUndefined();
  });
});

describe('tested diff --json — flags for agents', () => {
  let both: string;

  beforeAll(async () => {
    both = (await makeFlagRepo()).repo;
  });

  afterAll(async () => {
    await rm(both, { recursive: true, force: true });
  });

  it('includes the same flags.frontend fail slug as check --json', async () => {
    const check = await invokeCli(['check', '--base', 'main', '--json'], { cwd: both });
    const diff = await invokeCli(['diff', '--base', 'main', '--json'], { cwd: both });
    expect(diff.exitCode).toBe(0);
    const checkJson = JSON.parse(check.stdout) as { flags: IngestBody['flags'] };
    const diffJson = JSON.parse(diff.stdout) as {
      schemaVersion: number;
      flags?: IngestBody['flags'];
    };
    expect(diffJson.schemaVersion).toBe(1);
    expect(diffJson.flags).toEqual(checkJson.flags);
    expect(diffJson.flags?.frontend?.patchCheck).toBe('tested.dev / patch / frontend');
  });
});
