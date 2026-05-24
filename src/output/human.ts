import pc from 'picocolors';
import type { DiffOutput, UncoveredRange } from '../schemas.js';

function formatRange(r: UncoveredRange): string {
  return r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
}

function colorPct(pct: number): string {
  if (pct >= 80) return pc.green(`${pct}%`);
  if (pct >= 50) return pc.yellow(`${pct}%`);
  return pc.red(`${pct}%`);
}

export function formatHuman(out: DiffOutput): string {
  const lines: string[] = [];
  lines.push(pc.bold(`tested.dev — coverage report`));
  lines.push(`Base: ${out.base}  Head: ${out.head.slice(0, 7)}`);
  lines.push('');
  lines.push(
    `Patch coverage:   ${colorPct(out.patch.pct)} (${out.patch.covered}/${out.patch.executable})`,
  );
  lines.push(
    `Project coverage: ${colorPct(out.project.pct)} (${out.project.covered}/${out.project.executable})`,
  );
  if (out.files.length > 0) {
    lines.push('');
    lines.push(pc.bold('Files in diff:'));
    for (const f of out.files) {
      const patchStr = f.patchCoverage === null ? '   -  ' : `${colorPct(f.patchCoverage)}`;
      const ranges = f.uncoveredRanges.map(formatRange).join(', ');
      lines.push(
        `  ${patchStr.padEnd(6)}  ${f.path}${ranges ? pc.dim(`  uncovered: ${ranges}`) : ''}`,
      );
    }
  }
  if (out.ignored.length > 0) {
    lines.push('');
    lines.push(pc.dim(`Ignored: ${out.ignored.length} patterns`));
  }
  return lines.join('\n');
}
