/**
 * Runtime e2e — path-level coverage floors.
 *
 * Two-path fixture (`src/api/**` under its floor, `src/cli/**` at/above).
 * Real `tested check --json` — assert overall fail + the two path results.
 * Not a string grep.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { invokeCli } from '../helpers/invoke-cli.js';
import { makePathRepo } from '../helpers/path-repo.js';
import { PathsJsonSchema } from '../../src/schemas.js';

describe('runtime e2e — path-level coverage thresholds', () => {
  let repo: string | undefined;

  beforeAll(async () => {
    repo = (await makePathRepo()).repo;
  });

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('fails check when one glob is under its floor and reports both path results', async () => {
    const cwd = repo;
    if (cwd === undefined) {
      throw new Error('path-threshold fixture was not created');
    }
    const result = await invokeCli(['check', '--base', 'main', '--json'], { cwd });
    expect(result.exitCode).toBe(1);

    const gate = JSON.parse(result.stdout) as {
      overall: string;
      patch: { pct: number; threshold: number; pass: boolean };
      project: { pct: number; threshold: number; pass: boolean };
      paths: {
        glob: string;
        status: string;
        present: boolean;
        patch: { pct: number; threshold: number; pass: boolean };
        project: { pct: number; threshold: number; pass: boolean };
      }[];
    };

    expect(gate.overall).toBe('fail');
    expect(gate.patch.pass).toBe(true);
    expect(gate.project.pass).toBe(true);
    expect(gate.patch.pct).toBeGreaterThanOrEqual(gate.patch.threshold);
    expect(gate.project.pct).toBeGreaterThanOrEqual(gate.project.threshold);

    expect(Array.isArray(gate.paths)).toBe(true);
    expect(() => PathsJsonSchema.parse(gate.paths)).not.toThrow();
    expect(gate.paths).toHaveLength(2);

    const api = gate.paths.find((p) => p.glob === 'src/api/**');
    const cli = gate.paths.find((p) => p.glob === 'src/cli/**');
    expect(api).toBeDefined();
    expect(cli).toBeDefined();

    expect(api!.status).toBe('fail');
    expect(api!.present).toBe(true);
    expect(api!.patch.pct).toBe(80);
    expect(api!.patch.threshold).toBe(90);
    expect(api!.patch.pass).toBe(false);
    expect(api!.project.threshold).toBe(90);
    expect(api!.project.pass).toBe(false);
    expect(typeof api!.patch.pct).toBe('number');
    expect(typeof api!.patch.threshold).toBe('number');

    expect(cli!.status).toBe('pass');
    expect(cli!.present).toBe(true);
    expect(cli!.patch.pct).toBe(100);
    expect(cli!.patch.threshold).toBe(70);
    expect(cli!.patch.pass).toBe(true);
    expect(cli!.project.threshold).toBe(70);
    expect(cli!.project.pass).toBe(true);
    expect(cli!.patch.pct).toBeGreaterThanOrEqual(cli!.patch.threshold);
    expect(cli!.project.pct).toBeGreaterThanOrEqual(cli!.project.threshold);
  });
});
