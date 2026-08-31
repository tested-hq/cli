import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { openRepo } from '../git.js';
import type { FileCoverage } from '../core/istanbul.js';
import { assertWithinRoot } from '../core/assert-within-root.js';
import { parseAndMergeCoverage, resolveCoveragePaths } from '../core/coverage-paths.js';
import { badge, dim, heading } from '../output/ui.js';

export interface ExplainResult {
  path: string;
  line: number;
  uncovered: boolean;
  reason: string;
  codeExcerpt: string;
}

export function parseLocation(input: string): { path: string; line: number } {
  const idx = input.lastIndexOf(':');
  if (idx < 0) throw new Error(`expected <file>:<line>, got ${input}`);
  const path = input.slice(0, idx);
  const line = Number(input.slice(idx + 1));
  if (!Number.isInteger(line) || line <= 0) {
    throw new Error(`expected <file>:<line>, got ${input}`);
  }
  return { path, line };
}

export function explainAt(
  file: FileCoverage,
  line: number,
  sourceLines: readonly string[],
): ExplainResult {
  const stmt = file.statements.find((s) => line >= s.startLine && line <= s.endLine);
  const excerptStart = Math.max(1, line - 2);
  const excerptEnd = Math.min(sourceLines.length, line + 2);
  const excerpt = sourceLines
    .slice(excerptStart - 1, excerptEnd + 1)
    .map((text, i) => `${excerptStart + i}  ${text}`)
    .join('\n');

  if (!stmt) {
    return {
      path: file.path,
      line,
      uncovered: false,
      reason: `no executable statement on line ${line}`,
      codeExcerpt: excerpt,
    };
  }
  if (stmt.hits === 0) {
    return {
      path: file.path,
      line,
      uncovered: true,
      reason: `no test exercises line ${line}`,
      codeExcerpt: excerpt,
    };
  }
  return {
    path: file.path,
    line,
    uncovered: false,
    reason: `hit ${stmt.hits} time${stmt.hits === 1 ? '' : 's'}`,
    codeExcerpt: excerpt,
  };
}

export function formatExplainHuman(result: ExplainResult): string {
  const status = result.uncovered ? badge('fail') : badge('pass');
  const statusLabel = result.uncovered ? 'UNCOVERED' : 'covered';
  const lines: string[] = [];
  lines.push(heading('tested.dev — explain'));
  lines.push(`${result.path}:${result.line}  ${status}  ${statusLabel}`);
  lines.push(dim(result.reason));
  lines.push('');
  lines.push(result.codeExcerpt);
  return lines.join('\n');
}

export function registerExplainCommand(program: Command): void {
  program
    .command('explain')
    .description('Explain coverage at <file>:<line>')
    .argument('<location>', 'Location in the form path/to/file.ts:42')
    .option('--json', 'Emit JSON instead of human text', false)
    .action(async (location: string, opts: { json: boolean }) => {
      try {
        const cwd = process.cwd();
        const { path: relPath, line } = parseLocation(location);
        const config = await loadConfig({ cwd });
        const ctx = await openRepo(cwd);
        const files = await parseAndMergeCoverage({
          paths: resolveCoveragePaths({ configPath: config.coverage.path }),
          cwd,
          repoRoot: ctx.repoRoot,
          ...(config.coverage.format ? { format: config.coverage.format } : {}),
        });
        const file = files.find((f) => f.path === relPath);
        if (!file) {
          process.stderr.write(`error: no coverage data for ${relPath}\n`);
          process.exitCode = 2;
          return;
        }
        const resolvedSource = resolve(ctx.repoRoot, relPath);
        assertWithinRoot(ctx.repoRoot, resolvedSource);
        const source = await readFile(resolvedSource, 'utf8');
        const sourceLines = source.split('\n');
        const result = explainAt(file, line, sourceLines);
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
          process.stdout.write(formatExplainHuman(result) + '\n');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
