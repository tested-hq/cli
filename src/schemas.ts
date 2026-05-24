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
