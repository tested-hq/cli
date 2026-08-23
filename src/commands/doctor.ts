import { existsSync, accessSync, constants as fsConstants } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { Command } from 'commander';
import { simpleGit } from 'simple-git';
import { loadConfig } from '../config.js';
import {
  assertSafeApiBase,
  DEFAULT_API_BASE,
  parseGitHubRemote,
  resolveToken,
} from './push.js';
import { tokenMintGuidance } from '../token-help.js';
import {
  badge,
  dim,
  formatCliError,
  heading,
  tip,
  type BadgeKind,
} from '../output/ui.js';

/** Basename policy for TESTED_BIN (MCP / agent hosts). */
export const TESTED_BIN_BASENAME_RE = /^tested(\.js)?$/;

/** Product floor. Matches engines.node. Below this, doctor exits 1. */
export const MIN_NODE_MAJOR = 24;

export type DoctorStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  /** Human detail — never include secrets. */
  detail: string;
  /** When true, a non-pass status does not fail the overall exit code. */
  optional?: boolean;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  /** True when every non-optional check is pass or skip. */
  ok: boolean;
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

export interface DoctorDeps {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Override process.version (tests). */
  nodeVersion?: string;
  /** Override fs.existsSync. */
  existsSyncFn?: typeof existsSync;
  /** Override simple-git factory. */
  gitFactory?: typeof simpleGit;
  loadConfigFn?: typeof loadConfig;
  resolveTokenFn?: typeof resolveToken;
  assertSafeApiBaseFn?: typeof assertSafeApiBase;
  json?: boolean;
}

function statusBadge(status: DoctorStatus): string {
  const kind: BadgeKind =
    status === 'pass'
      ? 'pass'
      : status === 'fail'
        ? 'fail'
        : status === 'warn'
          ? 'warn'
          : 'info';
  return badge(kind);
}

function formatCheckLine(check: DoctorCheck): string {
  const pad = check.label.padEnd(18);
  return `  ${pad}  ${statusBadge(check.status)}  ${dim(check.detail)}`;
}

export function formatDoctorHuman(result: Omit<DoctorResult, 'stdout' | 'stderr'>): string {
  const lines: string[] = [];
  lines.push(
    `${heading('tested.dev — doctor')}  ${result.ok ? badge('pass') : badge('fail')}`,
  );
  lines.push('');
  for (const c of result.checks) {
    lines.push(formatCheckLine(c));
  }
  lines.push('');
  if (result.ok) {
    lines.push(dim('environment looks ready'));
  } else {
    lines.push(tip('fix FAIL items, then re-run: tested doctor'));
  }
  lines.push('');
  return lines.join('\n');
}

export function buildDoctorJson(result: Omit<DoctorResult, 'stdout' | 'stderr'>): object {
  return {
    schemaVersion: 1,
    ok: result.ok,
    checks: result.checks.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      detail: c.detail,
      ...(c.optional ? { optional: true } : {}),
    })),
  };
}

function parseNodeMajor(version: string): number | null {
  const m = version.replace(/^v/, '').match(/^(\d+)/);
  if (!m) return null;
  return Number(m[1]);
}

/** True when path exists and is readable. */
function isReadableFile(
  path: string,
  exists: typeof existsSync,
): boolean {
  if (!exists(path)) return false;
  try {
    accessSync(path, fsConstants.R_OK);
    return true;
  } catch {
    return exists(path);
  }
}

/**
 * Run environment diagnostics. Never prints token values.
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorResult> {
  const cwd = deps.cwd;
  const env = deps.env ?? process.env;
  const exists = deps.existsSyncFn ?? existsSync;
  const gitFactory = deps.gitFactory ?? simpleGit;
  const loadConfigFn = deps.loadConfigFn ?? loadConfig;
  const resolveTokenFn = deps.resolveTokenFn ?? resolveToken;
  const assertSafe = deps.assertSafeApiBaseFn ?? assertSafeApiBase;
  const nodeVersion = deps.nodeVersion ?? process.version;
  const json = deps.json ?? false;

  const checks: DoctorCheck[] = [];

  // 1. Node version. engines.node is >=24; below that is a hard fail.
  const major = parseNodeMajor(nodeVersion);
  const nodeDisplay = nodeVersion.replace(/^v/, 'v');
  if (major !== null && major >= MIN_NODE_MAJOR) {
    checks.push({
      id: 'node',
      label: 'Node.js',
      status: 'pass',
      detail: `${nodeDisplay} (>= ${MIN_NODE_MAJOR})`,
    });
  } else {
    checks.push({
      id: 'node',
      label: 'Node.js',
      status: 'fail',
      detail: `${nodeDisplay} is below ${MIN_NODE_MAJOR}. Node >= ${MIN_NODE_MAJOR} required.`,
    });
  }

  // 2. Git repository
  let isRepo = false;
  try {
    const git = gitFactory({ baseDir: cwd });
    isRepo = await git.checkIsRepo();
  } catch {
    isRepo = false;
  }
  if (isRepo) {
    checks.push({
      id: 'git',
      label: 'Git repo',
      status: 'pass',
      detail: cwd,
    });
  } else {
    checks.push({
      id: 'git',
      label: 'Git repo',
      status: 'fail',
      detail: 'not a git repository — run from a repo root',
    });
  }

  // 3. .tested.yaml
  const configPath = join(cwd, '.tested.yaml');
  const hasConfig = exists(configPath);
  if (hasConfig) {
    checks.push({
      id: 'config',
      label: '.tested.yaml',
      status: 'pass',
      detail: configPath,
    });
  } else {
    checks.push({
      id: 'config',
      label: '.tested.yaml',
      status: 'fail',
      detail: 'missing — run: tested setup  (or tested init)',
    });
  }

  // 4. Coverage file (path from config when present)
  let coverageRel = 'coverage/coverage-final.json';
  if (hasConfig) {
    try {
      const config = await loadConfigFn({ cwd });
      coverageRel = config.coverage.path;
    } catch {
      // keep default path
    }
  }
  const coverageAbs = resolve(cwd, coverageRel);
  if (isReadableFile(coverageAbs, exists)) {
    checks.push({
      id: 'coverage',
      label: 'Coverage file',
      status: 'pass',
      detail: coverageRel,
      optional: true,
    });
  } else {
    checks.push({
      id: 'coverage',
      label: 'Coverage file',
      status: 'warn',
      detail: `missing ${coverageRel} — run: tested run`,
      optional: true,
    });
  }

  // 5. origin remote
  let originOwner: string | null = null;
  let originName: string | null = null;
  if (isRepo) {
    try {
      const git = gitFactory({ baseDir: cwd });
      const url = (await git.raw(['remote', 'get-url', 'origin'])).trim();
      if (url) {
        const parsed = parseGitHubRemote(url);
        if (parsed) {
          originOwner = parsed.owner;
          originName = parsed.name;
        }
        // Redact credentials if any. Never print tokens.
        const safe = url.replace(/\/\/([^/@\s]+)@/g, '//***@');
        checks.push({
          id: 'origin',
          label: 'origin remote',
          status: 'pass',
          detail: safe,
        });
      } else {
        checks.push({
          id: 'origin',
          label: 'origin remote',
          status: 'fail',
          detail: 'origin remote URL is empty',
        });
      }
    } catch {
      checks.push({
        id: 'origin',
        label: 'origin remote',
        status: 'fail',
        detail: 'no origin remote — git remote add origin <url>',
      });
    }
  } else {
    checks.push({
      id: 'origin',
      label: 'origin remote',
      status: 'skip',
      detail: 'skipped (not a git repo)',
    });
  }

  // 6. Token env/file — never print the value
  let tokenPresent = false;
  let tokenSource: string | null = null;
  try {
    const token = resolveTokenFn({ env, isTTY: false, warn: () => {} });
    if (token) {
      tokenPresent = true;
      if (env.TESTED_TOKEN) tokenSource = 'TESTED_TOKEN';
      else if (env.TESTED_INGEST_TOKEN) tokenSource = 'TESTED_INGEST_TOKEN';
      else if (env.TESTED_TOKEN_FILE) tokenSource = 'TESTED_TOKEN_FILE';
      else tokenSource = 'token';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // File unreadable / world-readable — report without echoing secrets
    checks.push({
      id: 'token',
      label: 'Ingest token',
      status: 'fail',
      detail: message.replace(/["'].{8,}["']/g, '"…"'),
      optional: true,
    });
    tokenPresent = false;
    tokenSource = null;
  }
  if (!checks.some((c) => c.id === 'token')) {
    if (tokenPresent) {
      checks.push({
        id: 'token',
        label: 'Ingest token',
        status: 'pass',
        detail: `set via ${tokenSource} (value not shown)`,
        optional: true,
      });
    } else {
      checks.push({
        id: 'token',
        label: 'Ingest token',
        status: 'warn',
        detail: `not set. ${tokenMintGuidance({ owner: originOwner, name: originName }).join('. ')}`,
        optional: true,
      });
    }
  }

  // 7. Optional API URL
  const rawApi = env.TESTED_API_URL;
  if (rawApi !== undefined && rawApi !== '') {
    try {
      const normalized = assertSafe(rawApi);
      checks.push({
        id: 'api_url',
        label: 'API URL',
        status: 'pass',
        detail: normalized,
        optional: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push({
        id: 'api_url',
        label: 'API URL',
        status: 'fail',
        detail: message,
        optional: true,
      });
    }
  } else {
    checks.push({
      id: 'api_url',
      label: 'API URL',
      status: 'pass',
      detail: `default ${DEFAULT_API_BASE} (unset TESTED_API_URL)`,
      optional: true,
    });
  }

  // 8. TESTED_BIN basename (only when set)
  const testedBin = env.TESTED_BIN;
  if (testedBin !== undefined && testedBin !== '') {
    const base = basename(testedBin);
    const okName = TESTED_BIN_BASENAME_RE.test(base);
    if (!okName) {
      checks.push({
        id: 'tested_bin',
        label: 'TESTED_BIN',
        status: 'fail',
        detail: `basename "${base}" must match /^tested(\\.js)?$/`,
        optional: true,
      });
    } else if (!isAbsolute(testedBin)) {
      checks.push({
        id: 'tested_bin',
        label: 'TESTED_BIN',
        status: 'warn',
        detail: 'relative path — prefer an absolute path to tested.js',
        optional: true,
      });
    } else {
      checks.push({
        id: 'tested_bin',
        label: 'TESTED_BIN',
        status: 'pass',
        detail: `basename ${base}`,
        optional: true,
      });
    }
  } else {
    checks.push({
      id: 'tested_bin',
      label: 'TESTED_BIN',
      status: 'skip',
      detail: 'unset (optional; used by MCP hosts)',
      optional: true,
    });
  }

  // Fail exit when any non-optional check is fail, OR when optional checks that
  // are hard-fails for safety (token file error, bad API URL, bad TESTED_BIN)
  // are fail. Coverage/token-missing stay warn (optional).
  const hardFailIds = new Set(['node', 'git', 'config', 'origin']);
  const safetyFailIds = new Set(['api_url', 'tested_bin', 'token']);
  const hasHardFail = checks.some(
    (c) => c.status === 'fail' && hardFailIds.has(c.id),
  );
  const hasSafetyFail = checks.some(
    (c) =>
      c.status === 'fail' &&
      safetyFailIds.has(c.id) &&
      // token missing is warn; only real resolve errors are fail
      !(c.id === 'token' && /not set/i.test(c.detail)),
  );
  const ok = !hasHardFail && !hasSafetyFail;
  const exitCode: 0 | 1 = ok ? 0 : 1;

  const summary = { checks, ok, exitCode };
  if (json) {
    return {
      ...summary,
      stdout: JSON.stringify(buildDoctorJson(summary), null, 2) + '\n',
      stderr: '',
    };
  }
  return {
    ...summary,
    stdout: formatDoctorHuman(summary),
    stderr: '',
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose local environment for the tested.dev agent loop')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (opts: { json: boolean }) => {
      try {
        const result = await runDoctor({
          cwd: process.cwd(),
          json: opts.json,
        });
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.stdout) process.stdout.write(result.stdout);
        process.exitCode = result.exitCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(formatCliError(message));
        process.exitCode = 1;
      }
    });
}
