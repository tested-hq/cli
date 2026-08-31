import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { FileCoverage } from './coverage-model.js';
import { parseIstanbulString } from './istanbul.js';
import { parseLcov } from './formats/lcov.js';
import { parseCobertura } from './formats/cobertura.js';
import { parseGcov, parseGcovPath } from './formats/gcov.js';
import { parseJacoco } from './formats/jacoco.js';
import {
  isSimpleCovJsonGem,
  isSimpleCovResultset,
  parseSimpleCov,
} from './formats/simplecov.js';

export const COVERAGE_FORMATS = [
  'istanbul-json',
  'v8-json',
  'lcov',
  'cobertura',
  'jacoco',
  'gcov',
  'simplecov',
] as const;

export type CoverageFormat = (typeof COVERAGE_FORMATS)[number];

/** Formats after alias resolution (`v8-json` → Istanbul JSON). */
export type ResolvedCoverageFormat = Exclude<CoverageFormat, 'v8-json'>;

export function isCoverageFormat(value: string): value is CoverageFormat {
  return (COVERAGE_FORMATS as readonly string[]).includes(value);
}

export function resolveCoverageFormat(
  format: CoverageFormat,
): ResolvedCoverageFormat {
  return format === 'v8-json' ? 'istanbul-json' : format;
}

export interface ParseCoverageOpts {
  path: string;
  repoRoot: string;
  /** When omitted, detect from filename then contents. */
  format?: CoverageFormat;
}

const MISSING_COVERAGE =
  'coverage file missing. Run `tested run` first, or set coverage.path in .tested.yaml.';

/**
 * Read a coverage artifact and normalize it to FileCoverage (path + statement hits).
 *
 * Auto-detect (when `format` is unset):
 * 1. Contents (Istanbul/V8 JSON, LCOV, Cobertura/JaCoCo XML, gcov text, SimpleCov)
 * 2. Filename (`coverage-final.json` → istanbul-json, `lcov.info` / `*.lcov`,
 *    `*cobertura*`, `*jacoco*`, `*.gcov`, `.resultset.json`)
 * 3. `coverage/coverage-final.json` defaults to Istanbul/V8 JSON
 */
export async function parseCoverage(
  opts: ParseCoverageOpts,
): Promise<FileCoverage[]> {
  const explicit = opts.format
    ? resolveCoverageFormat(opts.format)
    : undefined;

  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(opts.path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw missingCoverageError(opts.path);
    }
    throw err;
  }

  if (info.isDirectory()) {
    const format = explicit ?? detectFormatFromPath(opts.path) ?? 'gcov';
    if (format !== 'gcov') {
      throw new Error(
        `coverage path ${opts.path} is a directory; only gcov accepts a directory of .gcov files`,
      );
    }
    return parseGcovPath({ path: opts.path, repoRoot: opts.repoRoot });
  }

  let raw: string;
  try {
    raw = await readFile(opts.path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw missingCoverageError(opts.path);
    }
    throw err;
  }

  const format =
    explicit ??
    detectFormatFromContents(raw) ??
    detectFormatFromPath(opts.path) ??
    defaultIstanbulIfCoverageFinal(opts.path);

  if (!format) {
    throw new Error(
      `Unable to detect coverage format for ${opts.path}. ` +
        `Set coverage.format in .tested.yaml (${COVERAGE_FORMATS.filter((f) => f !== 'v8-json').join(', ')}).`,
    );
  }

  return parseCoverageText({
    raw,
    path: opts.path,
    repoRoot: opts.repoRoot,
    format,
  });
}

export function parseCoverageText(opts: {
  raw: string;
  path: string;
  repoRoot: string;
  format: ResolvedCoverageFormat;
}): FileCoverage[] {
  switch (opts.format) {
    case 'istanbul-json':
      return parseIstanbulString(opts.raw, opts.repoRoot, opts.path);
    case 'lcov':
      return parseLcov(opts.raw, opts.repoRoot);
    case 'cobertura':
      return parseCobertura(opts.raw, opts.repoRoot);
    case 'jacoco':
      return parseJacoco(opts.raw, opts.repoRoot);
    case 'gcov':
      return parseGcov(opts.raw, opts.repoRoot);
    case 'simplecov':
      return parseSimpleCov(opts.raw, opts.repoRoot);
    default: {
      const _exhaustive: never = opts.format;
      throw new Error(`Unsupported coverage format: ${String(_exhaustive)}`);
    }
  }
}

export function detectFormatFromPath(
  filePath: string,
): ResolvedCoverageFormat | undefined {
  const base = basename(filePath).toLowerCase();
  if (base === 'coverage-final.json') return 'istanbul-json';
  if (base === 'lcov.info' || base.endsWith('.lcov')) return 'lcov';
  if (base.includes('cobertura')) return 'cobertura';
  if (base.includes('jacoco')) return 'jacoco';
  if (base.endsWith('.gcov')) return 'gcov';
  if (base === '.resultset.json' || base === 'resultset.json') return 'simplecov';
  return undefined;
}

export function detectFormatFromContents(
  raw: string,
): ResolvedCoverageFormat | undefined {
  const text = raw.replace(/^\uFEFF/, '');
  const trimmed = text.trimStart();
  if (!trimmed) return undefined;

  if (/^\s*-:\s*0:Source:/m.test(trimmed.slice(0, 4000))) return 'gcov';

  const headLines = trimmed.slice(0, 2000);
  if (/^(TN:|SF:|DA:\d)/m.test(headLines)) return 'lcov';

  if (
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<coverage') ||
    trimmed.startsWith('<report')
  ) {
    return detectXmlFormat(trimmed.slice(0, 8000));
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(text) as unknown;
      if (isCoveragePyJson(data)) {
        throw new Error(
          'coverage.py JSON is not supported. Emit lcov or Cobertura XML ' +
            '(pytest-cov `--cov-report=lcov` or `--cov-report=xml`) instead.',
        );
      }
      if (isIstanbulJson(data)) return 'istanbul-json';
      if (isSimpleCovJsonGem(data) || isSimpleCovResultset(data)) {
        return 'simplecov';
      }
    } catch (err) {
      if (err instanceof Error && /coverage\.py JSON/.test(err.message)) {
        throw err;
      }
      return undefined;
    }
  }

  const firstData = trimmed.split(/\r?\n/).find((l) => l.includes(':'));
  if (firstData && /^\s*(?:#####|=======|\d+)\s*:\s*\d+:/.test(firstData)) {
    return 'gcov';
  }

  return undefined;
}

function detectXmlFormat(head: string): ResolvedCoverageFormat | undefined {
  const lower = head.toLowerCase();
  if (lower.includes('cobertura')) return 'cobertura';
  if (lower.includes('jacoco')) return 'jacoco';
  if (lower.includes('<report') && /<line\b[^>]*\bci\s*=/.test(lower)) {
    return 'jacoco';
  }
  if (lower.includes('<coverage') && /<line\b[^>]*\bhits\s*=/.test(lower)) {
    return 'cobertura';
  }
  if (lower.includes('<report')) return 'jacoco';
  if (lower.includes('<coverage')) return 'cobertura';
  return undefined;
}

function defaultIstanbulIfCoverageFinal(
  filePath: string,
): ResolvedCoverageFormat | undefined {
  const base = basename(filePath).toLowerCase();
  if (base === 'coverage-final.json') return 'istanbul-json';
  return undefined;
}

export function isIstanbulJson(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  const values = Object.values(data as Record<string, unknown>);
  if (values.length === 0) return true;
  return values.some(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      'statementMap' in v &&
      's' in v,
  );
}

function isCoveragePyJson(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  const rec = data as { meta?: unknown; files?: unknown };
  return (
    typeof rec.meta === 'object' &&
    rec.meta !== null &&
    typeof rec.files === 'object' &&
    rec.files !== null &&
    !Array.isArray(rec.files)
  );
}

function missingCoverageError(path: string): Error {
  return new Error(`${MISSING_COVERAGE} (${path})`);
}
