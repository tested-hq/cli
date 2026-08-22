import { describe, it, expect } from 'vitest';
import { formatHuman } from '../../src/output/human.js';
import type { DiffOutput } from '../../src/schemas.js';

const sample: DiffOutput = {
  schemaVersion: 1,
  base: 'origin/main',
  head: 'abc1234deadbeef',
  patch: { executable: 10, covered: 6, pct: 60 },
  project: { executable: 100, covered: 80, pct: 80, delta: null },
  files: [
    {
      path: 'src/auth.ts',
      patchCoverage: 50,
      projectCoverage: 70,
      uncoveredRanges: [{ start: 5, end: 7, kind: 'line' }],
    },
  ],
  ignored: ['migrations/**'],
};

describe('formatHuman', () => {
  it('mentions patch %, project %, and per-file uncovered ranges', () => {
    const text = formatHuman(sample, { tips: false });
    expect(text).toContain('coverage report');
    expect(text).toContain('Patch');
    expect(text).toContain('60.0%');
    expect(text).toContain('Project');
    expect(text).toContain('80.0%');
    expect(text).toContain('src/auth.ts');
    expect(text).toContain('5-7');
    expect(text).toContain('6/10');
  });

  it('shows gate verdict when thresholds are provided', () => {
    const text = formatHuman(sample, {
      thresholds: { patch: 80, project: 60 },
      tips: false,
    });
    expect(text).toContain('Gate');
    expect(text).toContain('[FAIL]');
    expect(text).toMatch(/patch 60\.0% < 80%/);
    expect(text).toMatch(/tested check would FAIL/);
    expect(text).toMatch(/Diff exits 0; check is the gate/);
  });

  it('shows PASS gate when both thresholds are met', () => {
    const text = formatHuman(sample, {
      thresholds: { patch: 50, project: 60 },
      tips: false,
    });
    expect(text).toContain('[PASS]');
  });

  it('shows project delta when present', () => {
    const withDelta: DiffOutput = {
      ...sample,
      project: { ...sample.project, delta: 1.5 },
    };
    const text = formatHuman(withDelta, { tips: false });
    expect(text).toContain('delta +1.5%');
  });

  it('explains empty patch (0/0) instead of looking broken', () => {
    const empty: DiffOutput = {
      ...sample,
      patch: { executable: 0, covered: 0, pct: 0 },
      files: [
        {
          path: 'src/util.ts',
          patchCoverage: null,
          projectCoverage: 90,
          uncoveredRanges: [],
        },
      ],
    };
    const text = formatHuman(empty, { tips: false });
    expect(text).toContain('no executable lines in patch');
    expect(text).not.toMatch(/Patch\s+0\.0%/);
    // File rows fall back to project % instead of repeating the empty-patch note.
    expect(text).toContain('src/util.ts');
    expect(text).toContain('90.0%');
    expect(text).toContain('project coverage');
    expect(text).not.toMatch(/src\/util\.ts[\s\S]*no executable lines in patch/);
  });

  it('wraps long uncovered range lists across lines', () => {
    const many: DiffOutput = {
      ...sample,
      files: [
        {
          path: 'src/big.ts',
          patchCoverage: 10,
          projectCoverage: 10,
          uncoveredRanges: Array.from({ length: 20 }, (_, i) => ({
            start: i * 10 + 1,
            end: i * 10 + 3,
            kind: 'line' as const,
          })),
        },
      ],
    };
    const text = formatHuman(many, { tips: false });
    expect(text).toContain('uncovered:');
    // At least one line-wrap marker (continuation indent after newline).
    expect(text.split('\n').filter((l) => l.includes('1-3') || l.includes('11-13')).length).toBeGreaterThan(0);
  });

  it('includes next-step tips by default', () => {
    const text = formatHuman(sample);
    expect(text).toContain('tested push --pr');
  });
});
