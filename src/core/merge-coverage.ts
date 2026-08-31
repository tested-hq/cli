import type { FileCoverage, StatementCoverage } from './coverage-model.js';

function statementKey(stmt: StatementCoverage): string {
  return `${stmt.startLine}:${stmt.endLine}:${stmt.id}`;
}

function sameRange(a: StatementCoverage, b: StatementCoverage): boolean {
  return a.startLine === b.startLine && a.endLine === b.endLine;
}

/**
 * Merge statements from two shards of the same file.
 *
 * Hits are **maxed** (not averaged, not last-wins). A line hit in any shard
 * stays covered. Unmatched statements are unioned so two shards that cover
 * different lines produce the full executable set.
 */
export function mergeStatements(
  left: readonly StatementCoverage[],
  right: readonly StatementCoverage[],
): StatementCoverage[] {
  const out = new Map<string, StatementCoverage>();
  for (const stmt of left) {
    out.set(statementKey(stmt), { ...stmt });
  }
  for (const stmt of right) {
    const exact = statementKey(stmt);
    const existing = out.get(exact);
    if (existing) {
      existing.hits = Math.max(existing.hits, stmt.hits);
      continue;
    }
    const rangeMatch = [...out.values()].find((prev) => sameRange(prev, stmt));
    if (rangeMatch) {
      rangeMatch.hits = Math.max(rangeMatch.hits, stmt.hits);
      continue;
    }
    out.set(exact, { ...stmt });
  }
  return [...out.values()].sort(
    (a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.id.localeCompare(b.id),
  );
}

/**
 * Union FileCoverage shards.
 *
 * - Different paths: keep both (last file does not replace the first).
 * - Same path: max hits per statement; union of statement ranges.
 */
export function mergeFileCoverage(shards: readonly (readonly FileCoverage[])[]): FileCoverage[] {
  const byPath = new Map<string, FileCoverage>();
  for (const shard of shards) {
    for (const file of shard) {
      const existing = byPath.get(file.path);
      if (!existing) {
        byPath.set(file.path, {
          path: file.path,
          absPath: file.absPath,
          statements: file.statements.map((s) => ({ ...s })),
        });
        continue;
      }
      byPath.set(file.path, {
        path: existing.path,
        absPath: existing.absPath,
        statements: mergeStatements(existing.statements, file.statements),
      });
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
