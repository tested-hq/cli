import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { openRepo } from '../git.js';
import { parseIstanbul, type FileCoverage } from '../core/istanbul.js';

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

export function registerExplainCommand(program: Command): void {
  program
    .command('explain')
    .description('Explain coverage at <file>:<line>')
    .argument('<location>', 'Location in the form path/to/file.ts:42')
    .option('--json', 'Emit JSON instead of human text', false)
    .action(async (location: string, opts: { json: boolean }) => {
      const cwd = process.cwd();
      const { path: relPath, line } = parseLocation(location);
      const config = await loadConfig({ cwd });
      const ctx = await openRepo(cwd);
      const coveragePath = resolve(cwd, config.coverage.path);
      const files = await parseIstanbul({ path: coveragePath, repoRoot: ctx.repoRoot });
      const file = files.find((f) => f.path === relPath);
      if (!file) {
        process.stderr.write(`No coverage data for ${relPath}\n`);
        process.exit(2);
      }
      const source = await readFile(resolve(cwd, relPath), 'utf8');
      const sourceLines = source.split('\n');
      const result = explainAt(file, line, sourceLines);
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(
          `${result.path}:${result.line} — ${result.uncovered ? 'UNCOVERED' : 'covered'}\n` +
            `${result.reason}\n\n${result.codeExcerpt}\n`,
        );
      }
    });
}
