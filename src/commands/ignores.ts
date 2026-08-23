import { Command } from 'commander';
import { loadConfig } from '../config.js';

export function formatIgnoresList(patterns: readonly string[], asJson: boolean): string {
  if (asJson) return JSON.stringify({ ignores: [...patterns] });
  return patterns.join('\n');
}

async function printIgnores(asJson: boolean): Promise<void> {
  const config = await loadConfig({ cwd: process.cwd() });
  process.stdout.write(formatIgnoresList(config.ignores, asJson) + '\n');
}

export function registerIgnoresCommand(program: Command): void {
  const cmd = program
    .command('ignores')
    .description('List ignore patterns (defaults + user). `list` is optional.')
    .option('--json', 'Emit JSON', false)
    .action(async (opts: { json: boolean }) => {
      await printIgnores(opts.json);
    });
  cmd
    .command('list')
    .description('Print all ignore patterns (defaults + user)')
    .option('--json', 'Emit JSON', false)
    .action(async (opts: { json: boolean }) => {
      await printIgnores(opts.json);
    });
}
