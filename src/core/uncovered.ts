import type { FileCoverage } from './istanbul.js';
import type { UncoveredRange } from '../schemas.js';

export function uncoveredRanges(file: FileCoverage): UncoveredRange[] {
  const lines = new Set<number>();
  for (const stmt of file.statements) {
    if (stmt.hits > 0) continue;
    for (let line = stmt.startLine; line <= stmt.endLine; line += 1) {
      lines.add(line);
    }
  }
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: UncoveredRange[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const line of sorted) {
    if (start === null) {
      start = line;
      prev = line;
      continue;
    }
    if (prev !== null && line === prev + 1) {
      prev = line;
      continue;
    }
    ranges.push({ start, end: prev!, kind: 'line' });
    start = line;
    prev = line;
  }
  if (start !== null && prev !== null) {
    ranges.push({ start, end: prev, kind: 'line' });
  }
  return ranges;
}
