import pc from 'picocolors';
import { tokenMintGuidance } from '../token-help.js';

export type BadgeKind = 'pass' | 'fail' | 'warn' | 'info' | 'skip';

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
    case 'skip':
      return pc.cyan('[SKIP]');
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

/**
 * Map known error messages to multi-line guidance. Falls back to a single
 * `error: …` line. Always ends with a newline.
 */
export function formatCliError(message: string): string {
  const m = message.trim();

  if (/coverage-final\.json not found/i.test(m)) {
    const pathMatch = m.match(/at (.+?)\. Run/i);
    const path = pathMatch?.[1]?.trim();
    return errorBlock('coverage file missing', [
      path ? `Expected: ${path}` : 'Expected: coverage/coverage-final.json',
      '',
      'Run:  tested run',
      'Then: tested diff',
    ]);
  }

  if (/missing ingest token/i.test(m)) {
    return errorBlock('missing ingest token', [
      ...tokenMintGuidance(),
      'or pass --token <token> (avoid on shared hosts: visible in ps)',
    ]);
  }

  if (/git base ref .+ not found/i.test(m)) {
    const refMatch = m.match(/git base ref "([^"]+)" not found/i);
    const ref = refMatch?.[1] ?? 'the requested ref';
    return errorBlock(`git base ref "${ref}" not found`, [
      'That ref is not in this repository.',
      'Pass --base HEAD~1 (or a branch / commit that exists)',
      'or set `base:` in .tested.yaml',
    ]);
  }

  if (/invalid PR number/i.test(m)) {
    return errorBlock('invalid PR number', [
      m.replace(/^invalid PR number\s*/i, '').replace(/^—\s*/, '') || m,
      '',
      'Pass --pr <n> or set GITHUB_PR_NUMBER',
    ]);
  }

  // Already multi-line blocks from callers (push etc.) — pass through.
  if (m.startsWith('error:') || m.includes('\n')) {
    return m.endsWith('\n') ? m : `${m}\n`;
  }

  return `${pc.red('error')}: ${m}\n`;
}
