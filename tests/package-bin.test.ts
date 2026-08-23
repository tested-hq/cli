import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
