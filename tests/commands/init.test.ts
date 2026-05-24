import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  detectTestRunner,
  buildInitYaml,
  formatInitResultHuman,
  buildInitJsonOutput,
  runInit,
  type DetectedProject,
} from '../../src/commands/init.js';

function mkTmp(prefix = 'tested-init-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('detectTestRunner', () => {
  it('detects vitest from vitest.config.ts', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'vitest.config.ts'), 'export default {};');
    expect(detectTestRunner(dir)).toBe('vitest');
    rmSync(dir, { recursive: true, force: true });
  });
  it('detects vitest from vitest.config.js', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'vitest.config.js'), 'export default {};');
    expect(detectTestRunner(dir)).toBe('vitest');
    rmSync(dir, { recursive: true, force: true });
  });
  it('detects jest from jest.config.js', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'jest.config.js'), 'module.exports = {};');
    expect(detectTestRunner(dir)).toBe('jest');
    rmSync(dir, { recursive: true, force: true });
  });
  it('detects pytest from pyproject.toml', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    expect(detectTestRunner(dir)).toBe('pytest');
    rmSync(dir, { recursive: true, force: true });
  });
  it('returns null when nothing is found', () => {
    const dir = mkTmp();
    expect(detectTestRunner(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildInitYaml', () => {
  it('produces a yaml string that parses back to the expected shape', () => {
    const yaml = buildInitYaml({ base: 'main', testRunner: 'vitest' });
    const parsed = parseYaml(yaml);
    expect(parsed.base).toBe('main');
    expect(parsed.testRunner).toBe('vitest');
    expect(parsed.thresholds).toEqual({ patch: 80, project: 60 });
    expect(parsed.ignores).toContain('**/*.test.ts');
    expect(parsed.ignores).toContain('**/*.spec.ts');
    expect(parsed.ignores).toContain('**/node_modules/**');
    expect(parsed.ignores).toContain('**/dist/**');
    expect(parsed.ignores).toContain('**/coverage/**');
  });
  it('omits testRunner when null', () => {
    const yaml = buildInitYaml({ base: 'develop', testRunner: null });
    const parsed = parseYaml(yaml);
    expect(parsed.testRunner).toBeUndefined();
    expect(parsed.base).toBe('develop');
  });
  it('includes a docs comment at the top', () => {
    const yaml = buildInitYaml({ base: 'main', testRunner: null });
    expect(yaml.startsWith('# Config schema')).toBe(true);
    expect(yaml).toContain('tested.dev/docs/config');
  });
});

describe('buildInitJsonOutput', () => {
  it('serializes everything we did', () => {
    const out = buildInitJsonOutput({
      configPath: '/repo/.tested.yaml',
      configWritten: true,
      hookInstalled: true,
      hookPath: '/repo/.husky/pre-push',
      detected: { hasPackageJson: true, testRunner: 'vitest', defaultBranch: 'main' },
      nextSteps: ['a', 'b'],
      warnings: [],
    });
    expect(out.schemaVersion).toBe(1);
    expect(out.configWritten).toBe(true);
    expect(out.hookInstalled).toBe(true);
    expect(out.detected.testRunner).toBe('vitest');
    expect(out.nextSteps).toEqual(['a', 'b']);
  });
});

describe('formatInitResultHuman', () => {
  it('reports written config + next steps', () => {
    const text = formatInitResultHuman({
      configPath: '/repo/.tested.yaml',
      configWritten: true,
      hookInstalled: true,
      hookPath: '/repo/.husky/pre-push',
      detected: { hasPackageJson: true, testRunner: 'vitest', defaultBranch: 'main' },
      nextSteps: ['1. commit .tested.yaml'],
      warnings: [],
    });
    expect(text).toContain('.tested.yaml');
    expect(text).toContain('1. commit .tested.yaml');
    expect(text).toContain('vitest');
  });
  it('surfaces warnings', () => {
    const text = formatInitResultHuman({
      configPath: '/repo/.tested.yaml',
      configWritten: false,
      hookInstalled: false,
      hookPath: null,
      detected: { hasPackageJson: true, testRunner: null, defaultBranch: 'main' },
      nextSteps: [],
      warnings: ['husky not installed; skipped pre-push hook'],
    });
    expect(text).toContain('husky not installed');
  });
});

describe('runInit', () => {
  it('errors when there is no package.json', async () => {
    const dir = mkTmp();
    await expect(runInit({ cwd: dir, force: false, hooks: false })).rejects.toThrow(
      /package\.json/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes .tested.yaml when package.json exists', async () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    writeFileSync(join(dir, 'vitest.config.ts'), 'export default {};');
    const result = await runInit({ cwd: dir, force: false, hooks: false });
    expect(result.configWritten).toBe(true);
    expect(existsSync(join(dir, '.tested.yaml'))).toBe(true);
    const parsed = parseYaml(readFileSync(join(dir, '.tested.yaml'), 'utf8'));
    expect(parsed.testRunner).toBe('vitest');
    expect(parsed.base).toBe('main');
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to overwrite an existing .tested.yaml without --force', async () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    writeFileSync(join(dir, '.tested.yaml'), 'base: develop\n');
    await expect(runInit({ cwd: dir, force: false, hooks: false })).rejects.toThrow(
      /already exists/,
    );
    // file untouched
    expect(readFileSync(join(dir, '.tested.yaml'), 'utf8')).toBe('base: develop\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('overwrites when --force is passed', async () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    writeFileSync(join(dir, '.tested.yaml'), 'base: develop\n');
    const result = await runInit({ cwd: dir, force: true, hooks: false });
    expect(result.configWritten).toBe(true);
    const parsed = parseYaml(readFileSync(join(dir, '.tested.yaml'), 'utf8'));
    expect(parsed.base).toBe('main');
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips hook install with a warning when husky is not a devDep', async () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    const result = await runInit({ cwd: dir, force: false, hooks: true });
    expect(result.hookInstalled).toBe(false);
    expect(result.warnings.some((w) => /husky/.test(w))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('installs a pre-push hook when husky is present', async () => {
    const dir = mkTmp();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', devDependencies: { husky: '9.0.0' } }),
    );
    const result = await runInit({ cwd: dir, force: false, hooks: true });
    expect(result.hookInstalled).toBe(true);
    expect(result.hookPath).not.toBeNull();
    expect(existsSync(join(dir, '.husky/pre-push'))).toBe(true);
    const hookText = readFileSync(join(dir, '.husky/pre-push'), 'utf8');
    expect(hookText).toContain('tested diff');
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not overwrite an existing pre-push hook', async () => {
    const dir = mkTmp();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', devDependencies: { husky: '9.0.0' } }),
    );
    mkdirSync(join(dir, '.husky'));
    writeFileSync(join(dir, '.husky/pre-push'), '# existing hook\n');
    const result = await runInit({ cwd: dir, force: false, hooks: true });
    expect(result.hookInstalled).toBe(false);
    expect(result.warnings.some((w) => /pre-push/.test(w))).toBe(true);
    expect(readFileSync(join(dir, '.husky/pre-push'), 'utf8')).toBe('# existing hook\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips hook install entirely when hooks=false', async () => {
    const dir = mkTmp();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', devDependencies: { husky: '9.0.0' } }),
    );
    const result = await runInit({ cwd: dir, force: false, hooks: false });
    expect(result.hookInstalled).toBe(false);
    expect(existsSync(join(dir, '.husky/pre-push'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('DetectedProject', () => {
  it('is a structural type with the expected fields', () => {
    const d: DetectedProject = {
      hasPackageJson: true,
      testRunner: 'vitest',
      defaultBranch: 'main',
    };
    expect(d.hasPackageJson).toBe(true);
  });
});
