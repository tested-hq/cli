import type { DiffOutput, UncoveredRange } from '../schemas.js';
import {
  badge,
  colorPct,
  dim,
  heading,
  metricBar,
  tip,
} from './ui.js';

export interface FormatHumanOpts {
  /** When set, show a gate verdict vs these thresholds. */
  thresholds?: { patch: number; project: number };
  /** When true (default), append one-line next-step tips. */
  tips?: boolean;
}

function formatRange(r: UncoveredRange): string {
  return r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
}

/** Wrap a comma-separated list so long uncovered ranges don't dump one long line. */
function formatRangeList(ranges: readonly UncoveredRange[], maxWidth = 56): string {
  if (ranges.length === 0) return '';
  const parts = ranges.map(formatRange);
  const lines: string[] = [];
  let current = '';
  for (const part of parts) {
    if (!current) {
      current = part;
      continue;
    }
    if (current.length + 2 + part.length > maxWidth) {
      lines.push(current);
      current = part;
    } else {
      current += `, ${part}`;
    }
  }
  if (current) lines.push(current);
  return lines.join(',\n' + ' '.repeat(13));
}

function formatDelta(delta: number | null): string {
  if (delta === null) return '';
  const sign = delta > 0 ? '+' : '';
  return dim(`  delta ${sign}${delta.toFixed(1)}%`);
}

/** Color a pct then pad using the plain-text width so ANSI codes don't skew layout. */
function coloredPctCell(pct: number, width = 6): string {
  const plain = `${pct.toFixed(1)}%`;
  const pad = Math.max(0, width - plain.length);
  return colorPct(pct) + ' '.repeat(pad);
}

function formatMetricRow(
  label: string,
  pct: number,
  covered: number,
  executable: number,
  emptyNote?: string,
): string {
  const labelPad = label.padEnd(8);
  if (executable === 0) {
    const note = emptyNote ?? 'no executable lines';
    return `  ${labelPad}  ${dim('-'.padEnd(6))}  ${dim(note)}`;
  }
  const pctStr = coloredPctCell(pct);
  const bar = metricBar(pct);
  const counts = dim(`${covered}/${executable}`);
  return `  ${labelPad}  ${pctStr}  ${bar}  ${counts}`;
}

export function formatHuman(out: DiffOutput, opts: FormatHumanOpts = {}): string {
  const tips = opts.tips !== false;
  const lines: string[] = [];

  lines.push(heading('tested.dev — coverage report'));
  lines.push(dim(`Base: ${out.base}  Head: ${out.head.slice(0, 7)}`));
  lines.push('');

  lines.push(
    formatMetricRow(
      'Patch',
      out.patch.pct,
      out.patch.covered,
      out.patch.executable,
      'no executable lines in patch',
    ),
  );

  const projectRow = formatMetricRow(
    'Project',
    out.project.pct,
    out.project.covered,
    out.project.executable,
  );
  lines.push(projectRow + formatDelta(out.project.delta));

  if (opts.thresholds) {
    const patchPass = out.patch.pct >= opts.thresholds.patch;
    const projectPass = out.project.pct >= opts.thresholds.project;
    // Empty patch (0 executable) is treated as pass for display — nothing to gate.
    const patchOk = out.patch.executable === 0 ? true : patchPass;
    const overall = patchOk && projectPass;
    const details: string[] = [];
    if (!patchOk) {
      details.push(`patch ${out.patch.pct.toFixed(1)}% < ${opts.thresholds.patch}%`);
    }
    if (!projectPass) {
      details.push(
        `project ${out.project.pct.toFixed(1)}% < ${opts.thresholds.project}%`,
      );
    }
    const detail = details.length > 0 ? dim(`  ${details.join('; ')}`) : '';
    lines.push(
      `  ${'Gate'.padEnd(8)}  ${overall ? badge('pass') : badge('fail')}${detail}`,
    );
  }

  if (out.files.length > 0) {
    lines.push('');
    lines.push(heading('Files in diff:'));
    const anyPatch = out.files.some((f) => f.patchCoverage !== null);
    if (!anyPatch) {
      lines.push(dim('  (project coverage — no executable lines in patch)'));
    }
    for (const f of out.files) {
      // Prefer patch % when the file has executable patch lines; otherwise
      // show project % so agents still see what to fix.
      const hasPatch = f.patchCoverage !== null;
      const pctPart = hasPatch
        ? coloredPctCell(f.patchCoverage!)
        : coloredPctCell(f.projectCoverage);
      lines.push(`  ${pctPart}  ${f.path}`);
      if (f.uncoveredRanges.length > 0) {
        const ranges = formatRangeList(f.uncoveredRanges);
        lines.push(dim(`             uncovered: ${ranges}`));
      } else if (hasPatch) {
        lines.push(dim('             fully covered in patch'));
      }
    }
  }

  if (out.ignored.length > 0) {
    lines.push('');
    lines.push(dim(`Ignored: ${out.ignored.length} patterns`));
  }

  if (tips) {
    lines.push('');
    if (opts.thresholds) {
      const patchPass =
        out.patch.executable === 0 || out.patch.pct >= opts.thresholds.patch;
      const projectPass = out.project.pct >= opts.thresholds.project;
      if (!(patchPass && projectPass)) {
        lines.push(tip('tested check   (enforce thresholds)'));
      }
    } else {
      lines.push(tip('tested check   (enforce thresholds)'));
    }
    lines.push(tip('tested push --pr <n>   (share on tested.dev)'));
  }

  return lines.join('\n');
}
