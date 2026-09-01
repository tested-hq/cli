import { z } from 'zod';
import { COVERAGE_FORMATS } from './core/coverage.js';

export const CoverageFormatSchema = z.enum(COVERAGE_FORMATS);

/** GitHub-check-safe flag id (`tested.dev / patch / frontend`). */
export const FLAG_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const FlagNameSchema = z
  .string()
  .regex(FLAG_NAME_PATTERN, 'flag names must be alphanumeric plus _ . -');

export const FlagThresholdsSchema = z.object({
  patch: z.number().min(0).max(100).optional(),
  project: z.number().min(0).max(100).optional(),
});

export const FlagConfigSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  thresholds: FlagThresholdsSchema.optional(),
});

/**
 * Independent coverage floor for one path glob (`thresholds.paths`).
 * Omitted patch/project inherit the global floors. Not a flag.
 */
export const PathThresholdSchema = FlagThresholdsSchema.extend({
  glob: z.string().min(1),
});

export const TestedConfigSchema = z.object({
  ignores: z.array(z.string()).default([]),
  coverage: z
    .object({
      /** Omit to auto-detect from path and file contents. */
      format: CoverageFormatSchema.optional(),
      /**
       * One file or a list of files to merge (union of paths, max hits).
       * A CI matrix that uploads many files in one job should list them here
       * or pass `--file` / Action `files`.
       */
      path: z
        .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .default('coverage/coverage-final.json'),
    })
    .prefault({}),
  base: z.string().default('origin/main'),
  testRunner: z.enum(['vitest', 'jest', 'pytest']).nullable().default(null),
  // Patch / project coverage gates. `tested init` writes these so users can
  // tune what counts as "passing" — schema MUST accept them so loadConfig
  // doesn't silently drop the field.
  thresholds: z
    .object({
      patch: z.number().min(0).max(100),
      project: z.number().min(0).max(100),
      /**
       * Per-path glob floors. Graded from this run's matched files only.
       * A glob with no files this run is skipped (not 0%). Not flags.
       */
      paths: z.array(PathThresholdSchema).optional(),
    })
    .optional(),
  /**
   * Per-package gates. Each flag is graded from this run's coverage files
   * only — a missing path is skipped (not 0%), never another flag's totals.
   */
  flags: z.record(FlagNameSchema, FlagConfigSchema).optional(),
});

export type TestedConfig = z.infer<typeof TestedConfigSchema>;
export type CoverageFormat = z.infer<typeof CoverageFormatSchema>;
export type FlagConfig = z.infer<typeof FlagConfigSchema>;
export type FlagThresholds = z.infer<typeof FlagThresholdsSchema>;
export type PathThreshold = z.infer<typeof PathThresholdSchema>;

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

/**
 * Per-flag JSON (`tested check --json`, `tested diff --json`, ingest `flags`).
 * One schema — do not invent a second shape for push.
 */
export const FlagMetricJsonSchema = z.object({
  /** Omitted when this flag had no files this run (`skipped: true`). */
  pct: z.number().min(0).max(100).optional(),
  threshold: z.number().min(0).max(100),
  /** Omitted when skipped — a missing flag is not a 0% fail. */
  pass: z.boolean().optional(),
  executable: z.number().int().nonnegative().optional(),
  covered: z.number().int().nonnegative().optional(),
  skipped: z.literal(true).optional(),
  reason: z.string().optional(),
});

export const FlagResultJsonSchema = z.object({
  status: z.enum(['pass', 'fail', 'missing']),
  present: z.boolean(),
  /** True when this flag had no coverage files this run (not a 0% result). */
  skipped: z.literal(true).optional(),
  reason: z.string().optional(),
  patchCheck: z.string(),
  projectCheck: z.string(),
  patch: FlagMetricJsonSchema,
  project: FlagMetricJsonSchema,
});

export const FlagsJsonMapSchema = z.record(FlagNameSchema, FlagResultJsonSchema);

export type FlagMetricJson = z.infer<typeof FlagMetricJsonSchema>;
export type FlagResultJson = z.infer<typeof FlagResultJsonSchema>;
export type FlagsJsonMap = z.infer<typeof FlagsJsonMapSchema>;

/**
 * Per-path JSON (`tested check --json` `paths[]`). Same metric numbers as
 * flags (pct + threshold + pass) so the app scorecard and MCP share one shape.
 * No GitHub check slugs — coverage stays the only PR gate.
 */
export const PathResultJsonSchema = z.object({
  glob: z.string().min(1),
  status: z.enum(['pass', 'fail', 'missing']),
  present: z.boolean(),
  skipped: z.literal(true).optional(),
  reason: z.string().optional(),
  patch: FlagMetricJsonSchema,
  project: FlagMetricJsonSchema,
});

export const PathsJsonSchema = z.array(PathResultJsonSchema);

export type PathResultJson = z.infer<typeof PathResultJsonSchema>;
export type PathsJson = z.infer<typeof PathsJsonSchema>;

// Re-export test analytics schema (JUnit → optional ingest field)
export {
  TestReportSchema,
  type TestReport,
  type TestCaseRef,
} from './core/junit.js';
