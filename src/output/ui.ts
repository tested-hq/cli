import pc from 'picocolors';

export type BadgeKind = 'pass' | 'fail' | 'warn' | 'info';

/**
 * Whether ANSI color is enabled (respects NO_COLOR / non-TTY via picocolors).
 * Pure enough for tests: picocolors already gates on env + isTTY.
 */
export function isColorEnabled(): boolean {
  return pc.isColorSupported;
}

/** Status badge — color only for status semantics; monochrome ASCII labels. */
export function badge(kind: BadgeKind): string {
  switch (kind) {
    case 'pass':
      return pc.green('[PASS]');
    case 'fail':
      return pc.red('[FAIL]');
    case 'warn':
      return pc.yellow('[WARN]');
    case 'info':
      return pc.cyan('[INFO]');
  }
}

/**
 * Compact ASCII metric bar. Always ASCII (`#` / `.`) so it never
 * depends on wide-glyph terminal support.
 */
export function metricBar(pct: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const bar = '#'.repeat(filled) + '.'.repeat(width - filled);
  return `[${bar}]`;
}

export function heading(text: string): string {
  return pc.bold(text);
}

export function dim(text: string): string {
  return pc.dim(text);
}

/** Multi-line error block with indented guidance lines. */
export function errorBlock(title: string, lines: readonly string[] = []): string {
  const out: string[] = [`${pc.red('error')}: ${title}`];
  if (lines.length > 0) {
    out.push('');
    for (const line of lines) {
      out.push(line === '' ? '' : `  ${line}`);
    }
  }
  return out.join('\n') + '\n';
}

export function successLine(text: string): string {
  return `${pc.green('✓')} ${text}`;
}

/** Numbered next-steps block. */
export function nextSteps(steps: readonly string[]): string {
  if (steps.length === 0) return '';
  const lines = [heading('Next steps:')];
  steps.forEach((step, i) => {
    // Preserve leading numbering if the caller already numbered.
    const body = /^\d+\./.test(step.trim()) ? step.trim() : `${i + 1}. ${step}`;
    lines.push(`  ${body}`);
  });
  return lines.join('\n');
}

/** Single tip line: `→ do the thing` */
export function tip(text: string): string {
  return pc.dim(`→ ${text}`);
}

/** Color a percentage for status (green / yellow / red). */
export function colorPct(pct: number, digits = 1): string {
  const str = `${pct.toFixed(digits)}%`;
  if (pct >= 80) return pc.green(str);
  if (pct >= 50) return pc.yellow(str);
  return pc.red(str);
}

/** Highlight a share URL (bold + cyan when color is on). */
export function shareUrl(url: string): string {
  return pc.bold(pc.cyan(url));
}

/** Format a progress status line for stderr (dim, no trailing newline). */
export function progress(text: string): string {
  return pc.dim(text);
}
