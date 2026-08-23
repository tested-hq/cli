import type { DiffOutput, UncoveredRange } from '../schemas.js';
import { EMPTY_PATCH_REASON, isEmptyPatch } from '../core/patch.js';
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
    const note = emptyNote ?? EMPTY_PATCH_REASON;
    return `  ${labelPad}  ${dim('-'.padEnd(6))}  ${note}`;
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
      EMPTY_PATCH_REASON,
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
    const patchOk = isEmptyPatch(out.patch) ? true : patchPass;
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
    const detail = details.length > 0
      ? dim(`  ${details.join('; ')}`)
      : isEmptyPatch(out.patch)
        ? dim(`  ${EMPTY_PATCH_REASON}`)
        : '';
    lines.push(
      `  ${'Gate'.padEnd(8)}  ${overall ? badge('pass') : badge('fail')}${detail}`,
    );
    if (!overall) {
      lines.push('');
      lines.push(
        tip(
          `tested check would FAIL (${details.join('; ')}). Diff exits 0; check is the gate.`,
        ),
      );
    }
  }

  const patchFiles = out.files.filter((f) => f.patchCoverage !== null);

  if (isEmptyPatch(out.patch)) {
    lines.push('');
    lines.push(dim('No executable lines in the patch — patch gate does not apply.'));
  } else if (patchFiles.length > 0) {
    lines.push('');
    lines.push(heading('Files in diff:'));
    for (const f of patchFiles) {
      const pct = f.patchCoverage;
      if (pct === null) continue;
      lines.push(`  ${coloredPctCell(pct)}  ${f.path}`);
      if (f.uncoveredRanges.length > 0) {
        const ranges = formatRangeList(f.uncoveredRanges);
        lines.push(dim(`             uncovered: ${ranges}`));
      } else {
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
    if (!opts.thresholds) {
      lines.push(tip('tested check   (enforce thresholds)'));
    }
    lines.push(tip('tested push --pr <n>   (share on tested.dev)'));
  }

  return lines.join('\n');
}
