import { describe, expect, it } from 'vitest';
import {
  buildTestReportFromCases,
  parseJunitToTestReport,
  parseJunitXml,
} from '../src/core/junit.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="a" tests="4" failures="1" time="1.5">
    <testcase classname="auth" name="login ok" time="0.10"/>
    <testcase classname="auth" name="login fail" time="0.20">
      <failure message="expected 200"/>
    </testcase>
    <testcase classname="auth" name="retry me" time="0.05">
      <failure message="flaky"/>
    </testcase>
    <testcase classname="auth" name="retry me" time="0.08"/>
    <testcase classname="slow" name="big" time="1.2"/>
    <testcase classname="skip" name="later" time="0">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>
`;

describe('junit parse', () => {
  it('parses testcases', () => {
    const cases = parseJunitXml(SAMPLE);
    expect(cases.length).toBe(6);
    expect(cases.filter((c) => c.name === 'retry me')).toHaveLength(2);
  });

  it('marks flake when fail then pass', () => {
    const report = parseJunitToTestReport(SAMPLE);
    expect(report.totals.flaky).toBe(1);
    expect(report.flakes[0]?.name).toBe('retry me');
    expect(report.failures.some((f) => f.name === 'login fail')).toBe(true);
    expect(report.slowest[0]?.name).toBe('big');
    expect(report.totals.durationMs).toBeGreaterThan(0);
  });

  it('respects flaky attribute', () => {
    const report = buildTestReportFromCases([
      {
        name: 'x',
        classname: 'c',
        timeSec: 0.1,
        status: 'passed',
        flakyAttr: true,
      },
    ]);
    expect(report.totals.flaky).toBe(1);
  });

  it('parses error/skipped messages, nameless cases, and failure inner text', () => {
    const xml = `<?xml version="1.0"?>
<testsuite>
  <testcase classname="a" name="boom" time="0.1">
    <error message="kaboom"/>
  </testcase>
  <testcase name="skip-me" time="0">
    <skipped message="later"/>
  </testcase>
  <testcase name="" time="1"/>
  <testcase name="inner-fail" time="bad">
    <failure>stack
trace</failure>
  </testcase>
  <testcase name="self-close" time="0.01"/>
</testsuite>`;
    const cases = parseJunitXml(xml);
    expect(cases.find((c) => c.name === 'boom')?.status).toBe('error');
    expect(cases.find((c) => c.name === 'skip-me')?.message).toBe('later');
    expect(cases.some((c) => c.name === '')).toBe(false);
    expect(cases.find((c) => c.name === 'inner-fail')?.message).toMatch(/stack/);
    const report = parseJunitToTestReport(xml);
    expect(report.totals.errors).toBe(1);
    expect(report.totals.skipped).toBe(1);
    expect(report.failures.some((f) => f.name === 'inner-fail')).toBe(true);
  });
});
