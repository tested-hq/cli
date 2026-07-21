import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { computeDiff } from '../core/computeDiff.js';
import { formatHuman } from '../output/human.js';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Compute patch + project coverage against a base ref')
    .option('--base <ref>', 'Git base ref to diff against', undefined)
    .option('--with-base-coverage <path>', 'Compare project coverage against a baseline JSON', undefined)
    .option('--json', 'Emit schema-v1 JSON instead of human text', false)
    .action(async (opts: { base?: string; withBaseCoverage?: string; json: boolean }) => {
      try {
        const cwd = process.cwd();
        const config = await loadConfig({ cwd });
        const output = await computeDiff({
          cwd,
          config,
          ...(opts.base !== undefined ? { baseRef: opts.base } : {}),
          ...(opts.withBaseCoverage !== undefined
            ? { withBaseCoverage: opts.withBaseCoverage }
            : {}),
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        } else {
          process.stdout.write(
            formatHuman(output, {
              ...(config.thresholds ? { thresholds: config.thresholds } : {}),
              tips: true,
            }) + '\n',
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
