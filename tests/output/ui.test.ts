import { describe, it, expect } from 'vitest';
import {
  badge,
  metricBar,
  errorBlock,
  nextSteps,
  tip,
  colorPct,
  formatCliError,
} from '../../src/output/ui.js';

describe('ui helpers', () => {
  it('badge labels are ASCII status tags', () => {
    expect(badge('pass')).toContain('[PASS]');
    expect(badge('fail')).toContain('[FAIL]');
    expect(badge('warn')).toContain('[WARN]');
    expect(badge('info')).toContain('[INFO]');
  });

  it('metricBar fills proportionally with ASCII glyphs', () => {
    expect(metricBar(0, 10)).toBe('[..........]');
    expect(metricBar(100, 10)).toBe('[##########]');
    expect(metricBar(50, 10)).toBe('[#####.....]');
    expect(metricBar(150, 5)).toBe('[#####]'); // clamps
    expect(metricBar(-10, 5)).toBe('[.....]');
  });

  it('errorBlock indents guidance lines', () => {
    const block = errorBlock('missing ingest token', [
      'Pass --token <token>',
      'or set TESTED_TOKEN',
    ]);
    expect(block).toMatch(/^error: missing ingest token/);
    expect(block).toContain('  Pass --token <token>');
    expect(block).toContain('  or set TESTED_TOKEN');
    expect(block.endsWith('\n')).toBe(true);
  });

  it('nextSteps numbers items', () => {
    const text = nextSteps(['tested run', '2. tested diff']);
    expect(text).toContain('Next steps:');
    expect(text).toContain('1. tested run');
    expect(text).toContain('2. tested diff');
  });

  it('tip prefixes with arrow', () => {
    expect(tip('tested diff')).toContain('→ tested diff');
  });

  it('colorPct always includes the percent number', () => {
    expect(colorPct(42.7)).toContain('42.7%');
    expect(colorPct(100)).toContain('100.0%');
  });

  it('formatCliError expands coverage-missing into guided block', () => {
    const block = formatCliError(
      'coverage-final.json not found at /tmp/x/coverage/coverage-final.json. Run `tested run` first.',
    );
    expect(block).toContain('error: coverage file missing');
    expect(block).toContain('Expected: /tmp/x/coverage/coverage-final.json');
    expect(block).toContain('tested run');
    expect(block).toContain('tested diff');
  });
});
