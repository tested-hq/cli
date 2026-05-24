import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TestedConfigSchema, type TestedConfig } from './schemas.js';

export const DEFAULT_IGNORES = [
  'migrations/**',
  'seeds/**',
  'tests/**',
  'test/**',
  '**/*.test.*',
  '**/*.spec.*',
  'mocks/**',
  '__mocks__/**',
  'vitest.setup.*',
  'cypress/**',
  'scripts/**',
  'storybook/**',
  '.storybook/**',
  '**/*.d.ts',
  'stubs/**',
];

export async function loadConfig(opts: { cwd: string }): Promise<TestedConfig> {
  const file = join(opts.cwd, '.tested.yaml');
  let raw: unknown = {};
  try {
    const text = await readFile(file, 'utf8');
    raw = parseYaml(text) ?? {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const parsed = TestedConfigSchema.parse(raw);
  const merged = new Set([...DEFAULT_IGNORES, ...parsed.ignores]);
  return { ...parsed, ignores: [...merged] };
}
