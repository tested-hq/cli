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
});
