import { z } from 'zod';

/**
 * Compact JUnit-derived analytics attached to ingest as `testReport`.
 * Must stay in sync with app `lib/test-report.ts` (schemaVersion 1).
 */

/** Single test identity for grouping retries / flakes. */
export function testCaseKey(classname: string | undefined, name: string): string {
  return `${classname ?? ''}\0${name}`;
}

export const TestCaseRefSchema = z.object({
  name: z.string().min(1),
  classname: z.string().optional(),
  file: z.string().optional(),
  durationMs: z.number().nonnegative(),
});

export const TestReportSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('junit'),
  totals: z.object({
    tests: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    flaky: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  }),
  /** Final failures (did not pass on last attempt). */
  failures: z
    .array(
      TestCaseRefSchema.extend({
        message: z.string().optional(),
      }),
    )
    .max(50),
  /** Failed at least once and passed at least once in the same report. */
  flakes: z
    .array(
      TestCaseRefSchema.extend({
        attempts: z.number().int().positive(),
      }),
    )
    .max(50),
  slowest: z.array(TestCaseRefSchema).max(15),
});

export type TestReport = z.infer<typeof TestReportSchema>;
export type TestCaseRef = z.infer<typeof TestCaseRefSchema>;

type RawCase = {
  name: string;
  classname?: string;
  file?: string;
  timeSec: number;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  message?: string;
  flakyAttr: boolean;
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = tag.match(re);
  if (!m) return undefined;
  return decodeXmlEntities(m[2] ?? m[3] ?? '');
}

/**
 * Minimal JUnit XML parser (no deps). Handles nested testsuite / testcase,
 * failure/error/skipped children, time attributes, and flaky="true".
 */
export function parseJunitXml(xml: string): RawCase[] {
  const cases: RawCase[] = [];
  // Self-closing first; do not let [^>]* swallow the trailing slash into attrs.
  const re =
    /<testcase\b([^>]*?)\s*\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const openAttrs = (m[1] ?? m[2] ?? '').trim();
    const body = m[3] ?? '';
    const name = attr(openAttrs, 'name')?.trim();
    if (!name) continue;
    const classname = attr(openAttrs, 'classname')?.trim() || undefined;
    const file = attr(openAttrs, 'file')?.trim() || undefined;
    const timeRaw = attr(openAttrs, 'time');
    const timeSec = timeRaw != null && timeRaw !== '' ? Number(timeRaw) : 0;
    const flakyAttr =
      (attr(openAttrs, 'flaky') ?? '').toLowerCase() === 'true' ||
      (attr(openAttrs, 'flaky') ?? '') === '1';

    let status: RawCase['status'] = 'passed';
    let message: string | undefined;
    if (/<skipped\b/i.test(body)) {
      status = 'skipped';
      message = attr(body.match(/<skipped\b[^>]*>/i)?.[0] ?? '', 'message');
    } else if (/<failure\b/i.test(body)) {
      status = 'failed';
      const fm = body.match(/<failure\b([^>]*)\/?>/i);
      message = fm ? attr(fm[1] ?? '', 'message') : undefined;
      if (!message) {
        const inner = body.match(/<failure\b[^>]*>([\s\S]*?)<\/failure>/i);
        if (inner?.[1]?.trim()) message = decodeXmlEntities(inner[1].trim()).slice(0, 500);
      }
    } else if (/<error\b/i.test(body)) {
      status = 'error';
      const em = body.match(/<error\b([^>]*)\/?>/i);
      message = em ? attr(em[1] ?? '', 'message') : undefined;
    }

    cases.push({
      name,
      ...(classname ? { classname } : {}),
      ...(file ? { file } : {}),
      timeSec: Number.isFinite(timeSec) && timeSec >= 0 ? timeSec : 0,
      status,
      ...(message ? { message: message.slice(0, 500) } : {}),
      flakyAttr,
    });
  }
  return cases;
}

/**
 * Build a compact TestReport from raw JUnit cases.
 * Flake = same (classname, name) has both a failing and a passing attempt,
 * or flaky="true" on any attempt.
 */
export function buildTestReportFromCases(raw: RawCase[]): TestReport {
  const groups = new Map<string, RawCase[]>();
  for (const c of raw) {
    const k = testCaseKey(c.classname, c.name);
    const list = groups.get(k) ?? [];
    list.push(c);
    groups.set(k, list);
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errors = 0;
  let flaky = 0;
  let durationMs = 0;

  const failures: TestReport['failures'] = [];
  const flakes: TestReport['flakes'] = [];
  const durationByKey: Array<{
    name: string;
    classname?: string;
    file?: string;
    durationMs: number;
  }> = [];

  for (const [, attempts] of groups) {
    const totalTime = attempts.reduce((s, a) => s + a.timeSec, 0);
    const durationCaseMs = Math.round(totalTime * 1000);
    durationMs += durationCaseMs;

    const last = attempts[attempts.length - 1]!;
    const hadFail = attempts.some((a) => a.status === 'failed' || a.status === 'error');
    const hadPass = attempts.some((a) => a.status === 'passed');
    const isFlaky = Boolean(attempts.some((a) => a.flakyAttr) || (hadFail && hadPass));

    const ref = {
      name: last.name,
      ...(last.classname ? { classname: last.classname } : {}),
      ...(last.file ? { file: last.file } : {}),
      durationMs: durationCaseMs,
    };

    durationByKey.push(ref);

    if (isFlaky) {
      flaky += 1;
      if (flakes.length < 50) {
        flakes.push({ ...ref, attempts: attempts.length });
      }
    }

    // Final outcome: last non-skipped if present, else last
    const final =
      [...attempts].reverse().find((a) => a.status !== 'skipped') ?? last;

    if (final.status === 'skipped') {
      skipped += 1;
    } else if (final.status === 'passed') {
      passed += 1;
    } else if (final.status === 'error') {
      errors += 1;
      if (!isFlaky && failures.length < 50) {
        failures.push({
          ...ref,
          ...(final.message ? { message: final.message } : {}),
        });
      }
    } else if (final.status === 'failed') {
      failed += 1;
      if (!isFlaky && failures.length < 50) {
        failures.push({
          ...ref,
          ...(final.message ? { message: final.message } : {}),
        });
      }
    }
  }

  const slowest = [...durationByKey]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);

  return {
    schemaVersion: 1,
    source: 'junit',
    totals: {
      tests: groups.size,
      passed,
      failed,
      skipped,
      errors,
      flaky,
      durationMs,
    },
    failures,
    flakes,
    slowest,
  };
}

export function parseJunitToTestReport(xml: string): TestReport {
  return buildTestReportFromCases(parseJunitXml(xml));
}
