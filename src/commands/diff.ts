import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { computeDiffContext } from '../core/computeDiff.js';
import { collectCoverageFile } from '../core/coverage-paths.js';
import { resolveFlagsJson } from '../core/flags.js';
import { resolvePathThresholdsJson } from '../core/path-thresholds.js';
import { formatHuman } from '../output/human.js';
import { formatCliError } from '../output/ui.js';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Compute patch + project coverage against a base ref')
    .option('--base <ref>', 'Git base ref to diff against', undefined)
    .option('--with-base-coverage <path>', 'Compare project coverage against a baseline JSON', undefined)
    .option(
      '--file <path>',
      'Coverage file to merge (repeatable). Overrides coverage.path.',
      collectCoverageFile,
      [],
    )
    .option('--json', 'Emit schema-v1 JSON instead of human text', false)
    .action(async (opts: { base?: string; withBaseCoverage?: string; json: boolean; file?: string[] }) => {
      try {
        const cwd = process.cwd();
        const config = await loadConfig({ cwd });
        const { diff, files, addedByFile } = await computeDiffContext({
          cwd,
          config,
          ...(opts.base !== undefined ? { baseRef: opts.base } : {}),
          ...(opts.withBaseCoverage !== undefined
            ? { withBaseCoverage: opts.withBaseCoverage }
            : {}),
          ...(opts.file && opts.file.length > 0 ? { coveragePaths: opts.file } : {}),
        });

        if (opts.json) {
          const flags = resolveFlagsJson({ config, files, addedByFile });
          const paths = resolvePathThresholdsJson({ config, files, addedByFile });
          const payload = {
            ...diff,
            ...(flags ? { flags } : {}),
            ...(paths ? { paths } : {}),
          };
          process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        } else {
          process.stdout.write(
            formatHuman(diff, {
              ...(config.thresholds ? { thresholds: config.thresholds } : {}),
              tips: true,
            }) + '\n',
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(formatCliError(message));
        process.exitCode = 1;
      }
    });
}
