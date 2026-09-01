import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, DEFAULT_IGNORES } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');

describe('loadConfig', () => {
  it('returns defaults when no .tested.yaml exists', async () => {
    const cfg = await loadConfig({ cwd: join(here, '__missing__') });
    expect(cfg.ignores).toEqual(DEFAULT_IGNORES);
    expect(cfg.coverage.path).toBe('coverage/coverage-final.json');
    expect(cfg.base).toBe('origin/main');
  });

  it('merges user ignores with defaults', async () => {
    const cfg = await loadConfig({ cwd: fixtureDir });
    expect(cfg.ignores).toContain('scripts/**');
    expect(cfg.ignores).toContain('storybook/**');
    expect(cfg.ignores).toContain('**/*.d.ts');
    expect(cfg.coverage.path).toBe('./build/coverage-final.json');
    expect(cfg.base).toBe('origin/develop');
  });

  it('accepts coverage.path as a YAML list', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'tested-cfg-paths-'));
    writeFileSync(
      join(dir, '.tested.yaml'),
      ['coverage:', '  path:', '    - coverage/lcov.info', '    - coverage/python.xml', ''].join('\n'),
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.coverage.path).toEqual(['coverage/lcov.info', 'coverage/python.xml']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads thresholds.paths from .tested.yaml', async () => {
    const cfg = await loadConfig({ cwd: join(here, 'fixtures/paths') });
    expect(cfg.thresholds).toEqual({
      patch: 80,
      project: 50,
      paths: [
        { glob: 'src/api/**', patch: 90, project: 90 },
        { glob: 'src/cli/**', patch: 70, project: 70 },
      ],
    });
    expect(cfg.flags).toBeUndefined();
  });

  it('loads flags from .tested.yaml', async () => {
    const cfg = await loadConfig({ cwd: join(here, 'fixtures/flags') });
    expect(cfg.flags?.frontend?.paths).toEqual(['apps/web/**', 'packages/ui/**']);
    expect(cfg.flags?.frontend?.thresholds).toEqual({ patch: 90 });
    expect(cfg.flags?.backend?.paths).toEqual(['apps/api/**']);
    expect(cfg.thresholds).toEqual({ patch: 80, project: 60 });
  });

  it('rethrows non-ENOENT errors when reading .tested.yaml', async () => {
    const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'tested-cfg-'));
    mkdirSync(join(dir, '.tested.yaml'));
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({ code: 'EISDIR' });
    rmSync(dir, { recursive: true, force: true });
  });
});
