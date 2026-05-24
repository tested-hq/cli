import { resolve } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { openRepo, resolveBase, headSha, unifiedDiff } from '../git.js';
import { parseIstanbul } from '../core/istanbul.js';
import { parseUnifiedDiff } from '../core/diff.js';
import { splitByIgnore } from '../core/ignores.js';
import { buildDiffOutput } from '../output/json.js';
import { formatHuman } from '../output/human.js';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Compute patch + project coverage against a base ref')
    .option('--base <ref>', 'Git base ref to diff against', undefined)
    .option('--with-base-coverage <path>', 'Compare project coverage against a baseline JSON', undefined)
    .option('--json', 'Emit schema-v1 JSON instead of human text', false)
    .action(async (opts: { base?: string; withBaseCoverage?: string; json: boolean }) => {
      const cwd = process.cwd();
      const config = await loadConfig({ cwd });
      const ctx = await openRepo(cwd);
      const baseRef = opts.base ?? config.base;
      const base = await resolveBase(ctx, baseRef);
      const head = await headSha(ctx);
      const diffText = await unifiedDiff(ctx, base);
      const addedByFile = parseUnifiedDiff(diffText);

      const coveragePath = resolve(cwd, config.coverage.path);
      const allFiles = await parseIstanbul({ path: coveragePath, repoRoot: ctx.repoRoot });
      const { kept, ignored } = splitByIgnore(
        allFiles.map((f) => f.path),
        config.ignores,
      );
      const keptSet = new Set(kept);
      const files = allFiles.filter((f) => keptSet.has(f.path));

      let projectDelta: number | null = null;
      if (opts.withBaseCoverage) {
        const baseFiles = await parseIstanbul({
          path: resolve(cwd, opts.withBaseCoverage),
          repoRoot: ctx.repoRoot,
        });
        const baseKept = baseFiles.filter((f) => !ignored.includes(f.path));
        const baseExec = baseKept.reduce((n, f) => n + f.statements.length, 0);
        const baseCov = baseKept.reduce(
          (n, f) => n + f.statements.filter((s) => s.hits > 0).length,
          0,
        );
        const basePct = baseExec === 0 ? 0 : Math.round((baseCov / baseExec) * 1000) / 10;
        const headPct = (() => {
          const exec = files.reduce((n, f) => n + f.statements.length, 0);
          const cov = files.reduce(
            (n, f) => n + f.statements.filter((s) => s.hits > 0).length,
            0,
          );
          return exec === 0 ? 0 : Math.round((cov / exec) * 1000) / 10;
        })();
        projectDelta = Math.round((headPct - basePct) * 10) / 10;
      }

      const output = buildDiffOutput({
        base: baseRef,
        head,
        files,
        addedByFile,
        ignored,
        projectDelta,
      });

      if (opts.json) {
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      } else {
        process.stdout.write(formatHuman(output) + '\n');
      }
    });
}
