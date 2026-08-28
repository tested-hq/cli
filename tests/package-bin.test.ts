import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../src/cli.js';
import { CLI_VERSION } from '../src/version.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Mirrors npm's `getBinFromManifest` (libnpmexec): `npx @scope/pkg` picks a
 * default bin only when every bin value is the same file, or one bin name
 * matches the unscoped package name. Otherwise: "could not determine
 * executable to run".
 */
function npxDefaultBin(pkg: {
  name: string;
  bin?: string | Record<string, string>;
}): string | null {
  if (pkg.bin === undefined) return null;
  if (typeof pkg.bin === 'string') {
    return pkg.name.replace(/^@[^/]+\//, '');
  }
  const names = Object.keys(pkg.bin);
  if (names.length === 0) return null;
  if (new Set(Object.values(pkg.bin)).size === 1) {
    return names[0] ?? null;
  }
  const unscoped = pkg.name.replace(/^@[^/]+\//, '');
  return pkg.bin[unscoped] ? unscoped : null;
}

describe('package.json bin — npx @tested/cli', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    bin: Record<string, string>;
  };

  it('keeps tested and td after a local install', () => {
    expect(pkg.bin.tested).toBe('./dist/tested.js');
    expect(pkg.bin.td).toBeDefined();
  });

  it('gives npx a single default that runs tested', () => {
    // Two different bin *paths* (tested.js vs td.js) is what broke 0.1.0:
    // npx could not choose, even though td is just an alias.
    expect(new Set(Object.values(pkg.bin)).size).toBe(1);
    expect(npxDefaultBin(pkg)).toBe('tested');
    expect(pkg.bin[npxDefaultBin(pkg)!]).toBe('./dist/tested.js');
  });
});

describe('package honesty', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version: string;
    engines: { node: string };
    files: string[];
  };
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const actionReadme = readFileSync(join(root, 'action/README.md'), 'utf8');
  const gettingStarted = readFileSync(join(root, 'docs/GETTING-STARTED.md'), 'utf8');
  const actionYml = readFileSync(join(root, 'action/action.yml'), 'utf8');
  const runPushSh = readFileSync(join(root, 'action/run-push.sh'), 'utf8');
  const ciYml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

  it('is 0.1.8 with engines.node >=24', () => {
    expect(pkg.version).toBe('0.1.8');
    expect(pkg.engines.node).toBe('>=24');
    expect(readFileSync(join(root, '.nvmrc'), 'utf8').trim()).toBe('24');
    expect(CLI_VERSION).toBe(pkg.version);
    expect(createProgram().version()).toBe(pkg.version);
  });

  it('ships only dist + README + LICENSE (no docs that 404 on npm)', () => {
    expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE']);
  });

  it('points README docs at https://tested.dev/docs, not tarball-missing paths', () => {
    expect(readme).toContain('https://tested.dev/docs');
    expect(readme).not.toMatch(/\]\(docs\//);
    expect(readme).not.toMatch(/\]\(action\//);
    expect(readme).toMatch(/Node 24\+/);
    expect(readme).not.toMatch(/Node 22\+/);
    expect(actionReadme).toMatch(/Node 24\+/);
    expect(actionReadme).not.toMatch(/Node 22\+/);
    expect(gettingStarted).toMatch(/Node 24\+/);
    expect(gettingStarted).not.toMatch(/Node 22\+/);
    expect(readme).toContain('npx @tested/cli');
    expect(readme).toContain('pnpm exec -- tested --version');
  });

  it('defaults the Action version input to this package version', () => {
    expect(actionYml).toMatch(/version:\s*\n(?:.*\n)*?\s+default: '0\.1\.8'/);
    expect(actionYml).toContain('install-cli.sh');
    expect(actionYml).toContain('run-push.sh');
    expect(actionYml).toMatch(/tested check --base/);
    expect(runPushSh).toMatch(/tested push --pr "\$PR" --base "\$BASE"/);
    expect(runPushSh).toMatch(/tested push --mainline --base "\$BASE"/);
    expect(actionYml).not.toMatch(/node "\$BIN" check/);
    expect(actionYml).not.toMatch(/git clone/);
  });

  it('dogfoods hobby push on PRs without hardcoding the token', () => {
    expect(ciYml).toContain('uses: ./action');
    expect(ciYml).toContain("version: '0.1.8'");
    expect(ciYml).toContain("push: 'true'");
    expect(ciYml).toContain('pr-number: ${{ github.event.pull_request.number }}');
    expect(ciYml).toContain('token: ${{ secrets.TESTED_TOKEN }}');
    expect(ciYml).not.toMatch(/token:\s*['"]?(tested_|sk_)/i);
    expect(ciYml).not.toMatch(/TESTED_TOKEN:\s*['"][^$\s]/);
    expect(ciYml).toMatch(/name: tested check \+ hobby push/);
    expect(ciYml).toMatch(/needs:\s*test/);
    expect(ciYml).toContain('coverage-final.json');
    expect(ciYml).toContain('test-results/junit.xml');
    const testJob = ciYml.slice(
      ciYml.indexOf('name: typecheck + test + build'),
      ciYml.indexOf('name: tested check + hobby push'),
    );
    expect(testJob).not.toContain('uses: ./action');
    expect(actionYml).toMatch(
      /name: tested push \(optional\)\s*\n\s+if: inputs\.push == 'true'\s*\n\s+continue-on-error: true/,
    );
  });
});
