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
  program
    .command('ignores')
    .description('List ignore patterns (defaults + user). `list` is optional.')
    .argument('[subcommand]', 'optional "list" (the default)')
    .option('--json', 'Emit JSON', false)
    .action(async (subcommand: string | undefined, opts: { json: boolean }) => {
      if (subcommand !== undefined && subcommand !== 'list') {
        throw new Error(`unknown ignores subcommand "${subcommand}". Try: tested ignores list`);
      }
      await printIgnores(opts.json);
    });
}
