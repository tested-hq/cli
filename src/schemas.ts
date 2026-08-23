import { z } from 'zod';

export const TestedConfigSchema = z.object({
  ignores: z.array(z.string()).default([]),
  coverage: z
    .object({
      format: z.literal('istanbul-json').default('istanbul-json'),
      path: z.string().default('coverage/coverage-final.json'),
    })
    .prefault({}),
  base: z.string().default('origin/main'),
  testRunner: z.enum(['vitest', 'jest', 'pytest']).nullable().default(null),
  // Patch / project coverage gates. `tested init` writes these so users can
  // tune what counts as "passing" — schema MUST accept them so loadConfig
  // doesn't silently drop the field. Enforcement in `diff` lands in a
  // follow-up; today we just round-trip the values cleanly.
  thresholds: z
    .object({
      patch: z.number().min(0).max(100),
      project: z.number().min(0).max(100),
    })
    .optional(),
});

export type TestedConfig = z.infer<typeof TestedConfigSchema>;

export const UncoveredRangeSchema = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  kind: z.enum(['line', 'branch', 'function']),
});

export const FileCoverageSchema = z.object({
  path: z.string(),
  patchCoverage: z.number().nullable(),
  projectCoverage: z.number(),
  uncoveredRanges: z.array(UncoveredRangeSchema),
});

export const CoverageTotalsSchema = z.object({
  executable: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  pct: z.number().min(0).max(100),
  /** Present when executable === 0 — not a 0% coverage result. */
  empty: z.literal(true).optional(),
});

export const ProjectTotalsSchema = CoverageTotalsSchema.extend({
  delta: z.number().nullable(),
});

export const DiffOutputSchema = z.object({
  schemaVersion: z.literal(1),
  base: z.string(),
  head: z.string(),
  patch: CoverageTotalsSchema,
  project: ProjectTotalsSchema,
  files: z.array(FileCoverageSchema),
  ignored: z.array(z.string()),
});

export type DiffOutput = z.infer<typeof DiffOutputSchema>;
export type FileCoverage = z.infer<typeof FileCoverageSchema>;
export type UncoveredRange = z.infer<typeof UncoveredRangeSchema>;

// Re-export test analytics schema (JUnit → optional ingest field)
export {
  TestReportSchema,
  type TestReport,
  type TestCaseRef,
} from './core/junit.js';
