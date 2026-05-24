import { Command } from 'commander';
import { loadConfig } from '../config.js';

export function formatIgnoresList(patterns: readonly string[], asJson: boolean): string {
  if (asJson) return JSON.stringify({ ignores: [...patterns] });
  return patterns.join('\n');
}

export function registerIgnoresCommand(program: Command): void {
  const cmd = program.command('ignores').description('Inspect the canonical ignore list');
  cmd
    .command('list')
    .description('Print all ignore patterns (defaults + user)')
    .option('--json', 'Emit JSON', false)
    .action(async (opts: { json: boolean }) => {
      const config = await loadConfig({ cwd: process.cwd() });
      process.stdout.write(formatIgnoresList(config.ignores, opts.json) + '\n');
    });
}
