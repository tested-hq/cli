import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { rm } from 'node:fs/promises';
import { invokeCli } from '../helpers/invoke-cli.js';
import { makeFlagRepo, writeFlagCoverage } from '../helpers/flag-repo.js';
import { FlagsJsonMapSchema } from '../../src/schemas.js';

interface IngestCapture {
  flags?: {
    frontend?: {
      status: string;
      present: boolean;
      skipped?: boolean;
      patch: { pct?: number; executable?: number; pass?: boolean; skipped?: boolean };
    };
    backend?: {
      status: string;
      present: boolean;
      skipped?: boolean;
      patch: { pct?: number; executable?: number; pass?: boolean; skipped?: boolean };
    };
  };
}

function startIngestMock(): Promise<{
  url: string;
  bodies: IngestCapture[];
  close: () => Promise<void>;
}> {
  const bodies: IngestCapture[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/api/ingest') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      chunks.push(c);
    });
    req.on('end', () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString()) as IngestCapture);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ shareUrl: 'https://app.tested.dev/s/skip-e2e' }));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('ingest mock did not bind a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        bodies,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

describe('tested push — skipped flag is not 0% (two sequential CLI runs)', () => {
  let repo: string;
  let mock: Awaited<ReturnType<typeof startIngestMock>>;

  beforeAll(async () => {
    repo = (await makeFlagRepo()).repo;
    mock = await startIngestMock();
  });

  afterAll(async () => {
    await mock.close();
    await rm(repo, { recursive: true, force: true });
  });

  it('run 1 records frontend+backend; run 2 omits backend (files absent) and keeps new frontend', async () => {
    const pushArgs = [
      'push',
      '--json',
      '--token',
      't',
      '--pr',
      '1',
      '--owner',
      'acme',
      '--name',
      'mono',
      '--base',
      'main',
      '--url',
      mock.url,
    ];

    const check1 = await invokeCli(['check', '--base', 'main', '--json'], { cwd: repo });
    expect(check1.exitCode).toBe(1);
    const check1Json = JSON.parse(check1.stdout) as {
      flags: NonNullable<IngestCapture['flags']>;
    };
    expect(check1Json.flags.frontend?.status).toBe('fail');
    expect(check1Json.flags.frontend?.patch.pct).toBe(80);
    expect(check1Json.flags.frontend?.patch.executable).toBeGreaterThan(0);
    expect(check1Json.flags.backend?.status).toBe('pass');
    expect(check1Json.flags.backend?.patch.executable).toBeGreaterThan(0);
    const run1FrontendPct = check1Json.flags.frontend?.patch.pct;
    const run1BackendPct = check1Json.flags.backend?.patch.pct;
    const run1BackendExec = check1Json.flags.backend?.patch.executable;

    const push1 = await invokeCli(pushArgs, { cwd: repo });
    expect(push1.exitCode).toBe(0);
    expect(push1.stdout).toContain('shareUrl');
    expect(mock.bodies).toHaveLength(1);
    const body1 = mock.bodies[0]!;
    expect(() => FlagsJsonMapSchema.parse(body1.flags)).not.toThrow();
    expect(body1.flags?.frontend?.status).toBe('fail');
    expect(body1.flags?.frontend?.patch.pct).toBe(run1FrontendPct);
    expect(body1.flags?.backend?.status).toBe('pass');
    expect(body1.flags?.backend?.patch.pct).toBe(run1BackendPct);
    expect(body1.flags?.backend?.patch.executable).toBe(run1BackendExec);

    await writeFlagCoverage(repo, {
      includeBackend: false,
      frontendHits: [1, 1, 1, 1, 1, 1],
    });

    const check2 = await invokeCli(['check', '--base', 'main', '--json'], { cwd: repo });
    expect(check2.exitCode).toBe(0);
    const check2Json = JSON.parse(check2.stdout) as {
      overall: string;
      flags: NonNullable<IngestCapture['flags']>;
    };
    expect(check2Json.overall).toBe('pass');
    expect(check2Json.flags.frontend?.status).toBe('pass');
    expect(check2Json.flags.frontend?.patch.pct).toBe(100);
    expect(check2Json.flags.frontend?.patch.pct).not.toBe(run1FrontendPct);
    expect(check2Json.flags.backend?.status).toBe('missing');
    expect(check2Json.flags.backend?.skipped).toBe(true);
    expect(check2Json.flags.backend?.patch.skipped).toBe(true);
    expect(check2Json.flags.backend?.patch.executable).toBeUndefined();
    expect(check2Json.flags.backend?.patch.pct).toBeUndefined();
    expect(check2Json.flags.backend?.patch.pass).toBeUndefined();

    const check2Human = await invokeCli(['check', '--base', 'main'], { cwd: repo });
    expect(check2Human.exitCode).toBe(0);
    expect(check2Human.stdout).toContain('[MISSING]');
    expect(check2Human.stdout).not.toMatch(/backend[\s\S]{0,120}0\.0%/);
    expect(check2Human.stdout).not.toContain('no carryforward');

    const push2 = await invokeCli(pushArgs, { cwd: repo });
    expect(push2.exitCode).toBe(0);
    expect(mock.bodies).toHaveLength(2);
    const body2 = mock.bodies[1]!;
    expect(() => FlagsJsonMapSchema.parse(body2.flags)).not.toThrow();

    expect(body2.flags?.backend).toBeUndefined();
    expect(Object.keys(body2.flags ?? {})).toEqual(['frontend']);
    expect(body2.flags?.frontend?.status).toBe('pass');
    expect(body2.flags?.frontend?.present).toBe(true);
    expect(body2.flags?.frontend?.patch.pct).toBe(100);
    expect(body2.flags?.frontend?.patch.pct).not.toBe(run1FrontendPct);
    expect(body2.flags?.frontend?.patch.executable).toBeGreaterThan(0);
    expect(JSON.stringify(body2.flags)).not.toMatch(/"executable"\s*:\s*0/);
    expect(body2.flags?.backend?.patch.pct).not.toBe(0);
  });
});
