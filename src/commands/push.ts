import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { computeDiff } from '../core/computeDiff.js';
import {
  formatIncompleteGateMessage,
  hasShardMetadata,
  resolveCoverageMerge,
  toCoverageMergePayload,
  type CoverageMergeCli,
  type CoverageMergePayload,
  type CoverageMergeState,
} from '../core/coverage-merge.js';
import {
  collectCoverageFile,
  existingCoveragePaths,
  resolveCoveragePaths,
} from '../core/coverage-paths.js';
import {
  openRepo,
  headSha,
  remoteUrl,
  currentBranch,
  gitUserName,
  tryRevparse,
  fetchOriginRef,
  resolveAfterFetch,
  type GitContext,
} from '../git.js';
import { assertSafeGitRef } from '../git-ref.js';
import type { DiffOutput, TestedConfig } from '../schemas.js';
import type { TestReport } from '../core/junit.js';
import { parseJunitToTestReport } from '../core/junit.js';
import { dim, errorBlock, progress, shareUrl, successLine } from '../output/ui.js';
import { tokenMintGuidance } from '../token-help.js';

export const DEFAULT_API_BASE = 'https://app.tested.dev';
export const DEFAULT_API_HOST = 'app.tested.dev';

/** Hosts allowed to use plain http:// for local development only. */
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** GitHub `owner/name` as set in GITHUB_REPOSITORY. */
export const SAFE_GITHUB_REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * True when hostname is a tested.dev ingest host (not a lookalike suffix).
 * `evil.tested.dev.example` must not match.
 */
export function isAllowedApiHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'tested.dev' || host === DEFAULT_API_HOST || host.endsWith('.tested.dev');
}

export function isLocalDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HTTP_HOSTS.has(host) || host.endsWith('.localhost');
}

/**
 * Parse `owner/name` from GITHUB_REPOSITORY-style input.
 * Rejects credentials, extra path segments, and shell-metacharacter names.
 */
export function parseGitHubRepository(
  repo: string | undefined | null,
): { owner: string; name: string } | null {
  const raw = repo?.trim();
  if (!raw || !SAFE_GITHUB_REPOSITORY_RE.test(raw)) return null;
  const [owner, name] = raw.split('/');
  if (!owner || !name) return null;
  return { owner, name };
}

export interface PushCliOpts extends CoverageMergeCli {
  token?: string;
  url?: string;
  owner?: string;
  name?: string;
  pr?: string;
  prTitle?: string;
  author?: string;
  baseRef?: string;
  headRef?: string;
  runUrl?: string;
  base?: string;
  json: boolean;
  /** Default-branch coverage only (no PR / share URL). */
  mainline?: boolean;
  /** Path to JUnit XML for test analytics (flakes / slowest). */
  junit?: string;
  /** Coverage files to merge (repeatable `--file`). */
  file?: string[];
}

export interface IngestRepo {
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface IngestPr {
  number: number;
  title: string;
  authorLogin: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  state: 'open';
}

export interface IngestBody {
  repo: IngestRepo;
  pr?: IngestPr;
  runUrl: string | null;
  /**
   * Patch/project report. Omitted on a `--complete` handshake that has no
   * local coverage (finish job). App merges stored shards in that case.
   */
  diff?: DiffOutput;
  ref?: string;
  isDefaultBranch?: boolean;
  headSha?: string;
  /** Optional JUnit-derived analytics (schemaVersion 1). */
  testReport?: TestReport;
  /**
   * Shard handshake. App must NOT post GitHub checks / PR comment / gate
   * when `complete` is false. See `src/core/coverage-merge.ts`.
   */
  coverageMerge?: CoverageMergePayload;
}

export interface IngestSuccess {
  shareUrl?: string;
  expiresAt?: string;
  mainline?: boolean;
  date?: string;
  projectPct?: number;
  complete?: boolean;
}

export interface PushResult {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
  shareUrl?: string;
  expiresAt?: string;
  /** False when this upload must not conclude GitHub checks. */
  complete?: boolean;
}

/** Module-level guard so the --token argv warning prints at most once. */
let tokenArgvWarned = false;

/** Reset the once-flag (tests only). */
export function resetTokenArgvWarning(): void {
  tokenArgvWarned = false;
}

/**
 * Read token from a file path. Rejects world-readable modes when the platform
 * exposes POSIX mode bits (best-effort; Windows may skip the check).
 */
export function readTokenFile(
  filePath: string,
  opts?: { readFileSyncFn?: typeof readFileSync; statSyncFn?: typeof statSync },
): string {
  const read = opts?.readFileSyncFn ?? readFileSync;
  const stat = opts?.statSyncFn ?? statSync;
  let mode: number | undefined;
  try {
    const st = stat(filePath);
    mode = st.mode;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not stat TESTED_TOKEN_FILE "${filePath}": ${message}`);
  }
  // World-readable: other-read bit (0o004). Skip when mode looks non-POSIX.
  if (typeof mode === 'number' && (mode & 0o004) !== 0) {
    throw new Error(
      `TESTED_TOKEN_FILE "${filePath}" is world-readable; chmod 600 the file ` +
        `or move the token to TESTED_TOKEN`,
    );
  }
  let raw: string;
  try {
    raw = read(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read TESTED_TOKEN_FILE "${filePath}": ${message}`);
  }
  const token = raw.trim();
  if (!token) {
    throw new Error(`TESTED_TOKEN_FILE "${filePath}" is empty`);
  }
  return token;
}

/**
 * Resolve ingest token.
 *
 * Preference order (document prefer env over argv):
 *   1. --token flag (works, but warns once on TTY — visible in `ps`)
 *   2. TESTED_TOKEN
 *   3. TESTED_INGEST_TOKEN
 *   4. TESTED_TOKEN_FILE (file contents; rejects world-readable when possible)
 *
 * Flag still wins when provided so existing scripts keep working; prefer env
 * or TESTED_TOKEN_FILE so the secret does not appear on process argv.
 */
export function resolveToken(opts: {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  /** Override TTY detection (defaults to process.stderr.isTTY). */
  isTTY?: boolean;
  /** Warning sink (defaults to stderr). */
  warn?: (msg: string) => void;
  readFileSyncFn?: typeof readFileSync;
  statSyncFn?: typeof statSync;
}): string | null {
  const env = opts.env ?? process.env;
  const isTTY = opts.isTTY ?? Boolean(process.stderr.isTTY);
  const warn =
    opts.warn ??
    ((msg: string) => {
      process.stderr.write(msg);
    });

  if (opts.flag !== undefined && opts.flag !== '') {
    if (isTTY && !tokenArgvWarned) {
      tokenArgvWarned = true;
      warn(
        'warning: --token exposes the secret on process argv (visible to `ps` ' +
          'and audit agents). Prefer TESTED_TOKEN, TESTED_INGEST_TOKEN, or ' +
          'TESTED_TOKEN_FILE.\n',
      );
    }
    return opts.flag;
  }

  const fromEnv = env.TESTED_TOKEN ?? env.TESTED_INGEST_TOKEN;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;

  const tokenFile = env.TESTED_TOKEN_FILE;
  if (tokenFile) {
    return readTokenFile(tokenFile, {
      ...(opts.readFileSyncFn ? { readFileSyncFn: opts.readFileSyncFn } : {}),
      ...(opts.statSyncFn ? { statSyncFn: opts.statSyncFn } : {}),
    });
  }

  return null;
}

export interface AssertSafeApiBaseOpts {
  /**
   * When true, any https:// host is allowed (self-hosted ingest).
   * Off by default: the Bearer token must not be sent to an arbitrary host.
   */
  allowCustom?: boolean;
}

/**
 * Validate and normalize an ingest API base URL.
 *
 * Security: `--url` / TESTED_API_URL control where the ingest Bearer token is
 * sent. Reject non-https bases (except http://localhost for local dev), reject
 * embedded credentials, require a parseable absolute URL, and allowlist
 * `*.tested.dev` unless TESTED_ALLOW_CUSTOM_API_URL is set.
 */
export function assertSafeApiBase(
  raw: string,
  opts: AssertSafeApiBaseOpts = {},
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('API URL must not be empty');
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error(
      `invalid API URL "${trimmed}" — expected an absolute URL (e.g. https://app.tested.dev)`,
    );
  }
  if (u.username || u.password) {
    throw new Error('API URL must not embed credentials');
  }
  const host = u.hostname.toLowerCase();
  const local = isLocalDevHost(host);
  if (u.protocol === 'https:') {
    if (!local && !isAllowedApiHost(host) && !opts.allowCustom) {
      throw new Error(
        `API URL host "${u.hostname}" is not allowed. Ingest tokens are sent to this host. ` +
          `Use https://app.tested.dev, or set TESTED_ALLOW_CUSTOM_API_URL=1 for a private endpoint.`,
      );
    }
  } else if (u.protocol === 'http:' && local) {
    // local dev only
  } else {
    throw new Error(
      `API URL must use https:// (http:// allowed only for localhost). Got ${u.protocol}//${u.host}`,
    );
  }
  const path = u.pathname.replace(/\/+$/, '');
  const pathPart = !path || path === '/' ? '' : path;
  return `${u.origin}${pathPart}`;
}

function allowCustomApiUrl(env: NodeJS.ProcessEnv): boolean {
  const raw = env.TESTED_ALLOW_CUSTOM_API_URL;
  return raw === '1' || raw === 'true';
}

/** Resolve API base URL; strip trailing slash; enforce safe scheme/host. */
export function resolveApiBase(opts: {
  flag?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = opts.env ?? process.env;
  const flag = opts.flag?.trim();
  const fromEnv = env.TESTED_API_URL?.trim();
  const raw = flag || fromEnv || DEFAULT_API_BASE;
  return assertSafeApiBase(raw, { allowCustom: allowCustomApiUrl(env) });
}

/**
 * Redact userinfo from git remote URLs before putting them in error messages
 * (https://user:token@host/... must never appear in logs).
 */
export function redactGitRemote(url: string): string {
  const scrubbed = url.replace(/\/\/([^/@\s]+)@/g, '//***@');
  return scrubbed;
}

/**
 * Resolve PR number from --pr or env GITHUB_PR_NUMBER / PR_NUMBER.
 * Returns null when missing; throws when present but not a positive integer.
 */
export function resolvePrNumber(opts: {
  flag?: string;
  env?: NodeJS.ProcessEnv;
}): number | null {
  const env = opts.env ?? process.env;
  const raw = opts.flag ?? env.GITHUB_PR_NUMBER ?? env.PR_NUMBER;
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `invalid PR number "${raw}" — expected a positive integer (via --pr or GITHUB_PR_NUMBER)`,
    );
  }
  return n;
}

/**
 * Parse owner/name from a git remote URL.
 * Supports:
 *   - git@github.com:owner/name.git
 *   - https://github.com/owner/name.git
 *   - https://github.com/owner/name
 *   - ssh://git@github.com/owner/name.git
 */
export function parseGitHubRemote(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // git@host:owner/name(.git)
  const scp = trimmed.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (scp) return { owner: scp[1]!, name: scp[2]! };

  // https://host/owner/name(.git) or ssh://git@host/owner/name(.git)
  try {
    const normalized = trimmed.replace(/^git\+/, '');
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)
      ? normalized
      : `https://${normalized}`;
    const u = new URL(withProto);
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/i, '').split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], name: parts[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Turn a git name into a GitHub-login-ish slug. */
export function sanitizeAuthor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unknown';
}

/** Strip origin/ / refs/heads/ prefixes so API gets a branch name. */
export function toBranchName(ref: string): string {
  return ref
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\//, '')
    .replace(/^origin\//, '');
}

const GITHUB_COMMIT_SHA_RE = /^[0-9a-f]{40,64}$/i;

export interface GitHubPullBase {
  ref: string;
  sha: string;
}

export interface TokenMintIdentity {
  owner?: string | null;
  name?: string | null;
}

function githubApiToken(env: NodeJS.ProcessEnv): string | null {
  const raw = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (raw === undefined || raw === '') return null;
  return raw;
}

function parseGitHubPullBase(parsed: unknown): GitHubPullBase | null {
  if (!parsed || typeof parsed !== 'object' || !('base' in parsed)) return null;
  const base = parsed.base;
  if (!base || typeof base !== 'object') return null;
  const ref = 'ref' in base ? base.ref : undefined;
  const sha = 'sha' in base ? base.sha : undefined;
  if (typeof ref !== 'string' || typeof sha !== 'string') return null;
  if (!GITHUB_COMMIT_SHA_RE.test(sha)) return null;
  try {
    return { ref: assertSafeGitRef(ref), sha: assertSafeGitRef(sha) };
  } catch {
    return null;
  }
}

/**
 * PR base from GitHub (same payload the Action reads from the event).
 * Public repos work without a token; GITHUB_TOKEN / GH_TOKEN for private.
 * Failures are null — callers fall through to origin / fetch / the friendly error.
 */
export async function fetchGitHubPullBase(opts: {
  owner: string;
  name: string;
  prNumber: number;
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<GitHubPullBase | null> {
  if (!parseGitHubRepository(`${opts.owner}/${opts.name}`)) return null;
  if (!Number.isInteger(opts.prNumber) || opts.prNumber <= 0) return null;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const url = `https://api.github.com/repos/${opts.owner}/${opts.name}/pulls/${opts.prNumber}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'tested-cli',
  };
  const token = githubApiToken(opts.env ?? process.env);
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'GET', redirect: 'manual', headers });
  } catch {
    return null;
  }
  if (res.status !== 200) return null;
  try {
    return parseGitHubPullBase(JSON.parse(await res.text()));
  } catch {
    return null;
  }
}

/**
 * Git base for `tested push --pr` when `--base` is unset.
 *
 * Prefer a local or `origin/<base>` ref, then the PR base SHA from GitHub,
 * then `git fetch --depth=1 origin <sha|branch>` (the Action path).
 * Returns undefined so computeDiff can raise the 0.1.6 missing-base error.
 */
export async function resolvePrPushBase(opts: {
  ctx: GitContext;
  requested: string;
  prNumber: number;
  owner?: string | null;
  name?: string | null;
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  onProgress?: (msg: string) => void;
}): Promise<string | undefined> {
  let requested: string;
  try {
    requested = assertSafeGitRef(opts.requested);
  } catch {
    return undefined;
  }
  if (await tryRevparse(opts.ctx, requested)) return requested;

  const branch = toBranchName(requested) || 'main';
  const originRef = `origin/${branch}`;
  if (originRef !== requested && (await tryRevparse(opts.ctx, originRef))) {
    return originRef;
  }

  let prBase: GitHubPullBase | null = null;
  if (opts.owner && opts.name) {
    prBase = await fetchGitHubPullBase({
      owner: opts.owner,
      name: opts.name,
      prNumber: opts.prNumber,
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
      ...(opts.env ? { env: opts.env } : {}),
    });
  }
  if (prBase && (await tryRevparse(opts.ctx, prBase.sha))) return prBase.sha;

  const fetchTargets: string[] = [];
  if (prBase) {
    fetchTargets.push(prBase.sha, prBase.ref);
  }
  fetchTargets.push(branch);

  let announced = false;
  const seen = new Set<string>();
  for (const target of fetchTargets) {
    if (seen.has(target)) continue;
    seen.add(target);
    let spec: string;
    try {
      spec = assertSafeGitRef(target);
    } catch {
      continue;
    }
    if (!announced) {
      announced = true;
      opts.onProgress?.('fetching base…');
    }
    if (!(await fetchOriginRef(opts.ctx, spec))) continue;
    const resolved = await resolveAfterFetch(opts.ctx, spec);
    if (resolved) return resolved;
    if (prBase && (await tryRevparse(opts.ctx, prBase.sha))) return prBase.sha;
  }

  return undefined;
}

/** Best-effort owner/name for mint URLs and the GitHub PR lookup. */
export async function peekRepoIdentity(opts: {
  owner?: string;
  name?: string;
  env: NodeJS.ProcessEnv;
  ctx: GitContext;
}): Promise<TokenMintIdentity> {
  let owner = opts.owner;
  let name = opts.name;
  if (!owner || !name) {
    const fromActions = parseGitHubRepository(opts.env.GITHUB_REPOSITORY);
    if (fromActions) {
      owner = owner ?? fromActions.owner;
      name = name ?? fromActions.name;
    }
  }
  if (!owner || !name) {
    try {
      const origin = await remoteUrl(opts.ctx, 'origin');
      const parsed = parseGitHubRemote(origin);
      if (parsed) {
        owner = owner ?? parsed.owner;
        name = name ?? parsed.name;
      }
    } catch {
      // Ingest still reports a hard origin error after the diff.
    }
  }
  return { owner: owner ?? null, name: name ?? null };
}

export function buildIngestBody(input: {
  owner: string;
  name: string;
  baseRef: string;
  prNumber: number;
  prTitle: string;
  author: string;
  headRef: string;
  headSha: string;
  runUrl: string | null;
  diff?: DiffOutput;
  testReport?: TestReport;
  coverageMerge?: CoverageMergePayload;
}): IngestBody {
  const baseRefName = toBranchName(input.baseRef);
  return {
    repo: {
      owner: input.owner,
      name: input.name,
      defaultBranch: baseRefName,
    },
    pr: {
      number: input.prNumber,
      title: input.prTitle,
      authorLogin: input.author,
      baseRef: baseRefName,
      headRef: input.headRef,
      headSha: input.headSha,
      state: 'open',
    },
    runUrl: input.runUrl,
    ...(input.diff ? { diff: input.diff } : {}),
    ...(input.testReport ? { testReport: input.testReport } : {}),
    ...(input.coverageMerge ? { coverageMerge: input.coverageMerge } : {}),
  };
}


export function buildMainlineIngestBody(input: {
  owner: string;
  name: string;
  defaultBranch: string;
  headSha: string;
  ref: string;
  runUrl: string | null;
  diff?: DiffOutput;
  testReport?: TestReport;
  coverageMerge?: CoverageMergePayload;
}): IngestBody {
  return {
    repo: {
      owner: input.owner,
      name: input.name,
      defaultBranch: input.defaultBranch,
    },
    runUrl: input.runUrl,
    ...(input.diff ? { diff: input.diff } : {}),
    ref: input.ref,
    isDefaultBranch: true,
    headSha: input.headSha,
    ...(input.testReport ? { testReport: input.testReport } : {}),
    ...(input.coverageMerge ? { coverageMerge: input.coverageMerge } : {}),
  };
}

/** Common vitest/jest/CI report paths. Keep in sync with action/run-push.sh. */
export const DEFAULT_JUNIT_CANDIDATES = [
  'junit.xml',
  'test-results/junit.xml',
  'coverage/junit.xml',
  'reports/junit.xml',
] as const;

/**
 * Resolve JUnit XML path: --junit flag, TESTED_JUNIT env, then common paths.
 * Returns null if none found (analytics optional).
 */
export function resolveJunitPath(opts: {
  flag?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  existsSyncFn?: typeof existsSync;
}): string | null {
  const env = opts.env ?? process.env;
  const exists = opts.existsSyncFn ?? existsSync;
  if (opts.flag && opts.flag.trim()) {
    const p = opts.flag.trim();
    const abs = p.startsWith('/') ? p : join(opts.cwd, p);
    if (!exists(abs)) {
      throw new Error(`JUnit file not found: ${p}`);
    }
    return abs;
  }
  const fromEnv = env.TESTED_JUNIT?.trim();
  if (fromEnv) {
    const abs = fromEnv.startsWith('/') ? fromEnv : join(opts.cwd, fromEnv);
    if (!exists(abs)) {
      throw new Error(`TESTED_JUNIT file not found: ${fromEnv}`);
    }
    return abs;
  }
  for (const rel of DEFAULT_JUNIT_CANDIDATES) {
    const abs = join(opts.cwd, rel);
    if (exists(abs)) return abs;
  }
  return null;
}

export function loadTestReportFromJunit(
  path: string,
  readFn: typeof readFileSync = readFileSync,
): TestReport {
  const xml = readFn(path, 'utf8');
  return parseJunitToTestReport(xml);
}

export async function postIngest(opts: {
  apiBase: string;
  token: string;
  body: IngestBody;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; status: number; data: IngestSuccess }
  | { ok: false; status: number; message: string; code?: string }
> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const url = `${opts.apiBase}/api/ingest`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      // Do not follow redirects: a 3xx to another origin could exfiltrate the
      // Bearer token depending on the fetch implementation.
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(opts.body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, message: `network error: ${message}` };
  }

  if (res.status >= 300 && res.status < 400) {
    return {
      ok: false,
      status: res.status,
      message: `ingest redirected (${res.status}); refusing to follow redirects with Bearer token`,
    };
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  const concludesGate = opts.body.coverageMerge?.complete !== false;
  const handshakeOnly = concludesGate && !opts.body.diff;
  const acceptIncomplete = opts.body.coverageMerge?.complete === false;
  const successStatus = res.status === 200 || (acceptIncomplete && res.status === 202);

  if (successStatus) {
    const data = (parsed as Partial<IngestSuccess> | null) ?? {};
    if (data.mainline === true) {
      return {
        ok: true,
        status: res.status,
        data: {
          mainline: true,
          ...(typeof data.date === 'string' ? { date: data.date } : {}),
          ...(typeof data.projectPct === 'number' ? { projectPct: data.projectPct } : {}),
          ...(acceptIncomplete ? { complete: false } : {}),
        },
      };
    }
    const shareUrl =
      typeof data.shareUrl === 'string' && data.shareUrl ? data.shareUrl : undefined;
    if (concludesGate && !handshakeOnly && !acceptIncomplete && !shareUrl) {
      if (parsed === null) {
        return {
          ok: false,
          status: res.status,
          message: 'ingest succeeded but response was empty',
        };
      }
      return {
        ok: false,
        status: res.status,
        message: 'ingest succeeded but response missing shareUrl',
      };
    }
    return {
      ok: true,
      status: res.status,
      data: {
        ...(shareUrl ? { shareUrl } : {}),
        ...(typeof data.expiresAt === 'string' ? { expiresAt: data.expiresAt } : {}),
        ...(acceptIncomplete || handshakeOnly ? { complete: concludesGate } : {}),
      },
    };
  }

  let message = text || res.statusText || 'unknown error';
  let code: string | undefined;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.message === 'string') message = obj.message;
    else if (typeof obj.error === 'string') message = obj.error;
    if (typeof obj.code === 'string') code = obj.code;
    else if (typeof obj.error === 'string' && /^[a-z0-9_]+$/i.test(obj.error)) {
      code = obj.error;
    }
  }
  return { ok: false, status: res.status, message, ...(code ? { code } : {}) };
}

export function formatPushSuccess(
  data: IngestSuccess,
  json: boolean,
  merge?: CoverageMergeState,
): { stdout: string; stderr: string } {
  const incomplete = merge ? !merge.complete : data.complete === false;
  if (json) {
    const payload: Record<string, string | number | boolean> = {};
    if (data.shareUrl) payload.shareUrl = data.shareUrl;
    if (data.expiresAt) payload.expiresAt = data.expiresAt;
    if (data.mainline) payload.mainline = true;
    if (data.date) payload.date = data.date;
    if (typeof data.projectPct === 'number') payload.projectPct = data.projectPct;
    if (merge && hasShardMetadata(merge)) {
      payload.complete = merge.complete;
      if (merge.part !== undefined) payload.part = merge.part;
      if (merge.totalParts !== undefined) payload.totalParts = merge.totalParts;
    } else if (incomplete) {
      payload.complete = false;
    }
    return { stdout: JSON.stringify(payload) + '\n', stderr: '' };
  }
  const lines: string[] = [];
  if (incomplete && merge) {
    lines.push(successLine(`uploaded shard (${formatIncompleteGateMessage(merge)})`));
    if (data.shareUrl) {
      lines.push(dim(`  ${shareUrl(data.shareUrl)}  (pending — not a gate result)`));
    }
    return { stdout: lines.join('\n') + '\n', stderr: '' };
  }
  if (data.mainline) {
    lines.push(
      successLine(
        `mainline coverage recorded` +
          (typeof data.projectPct === 'number' ? `  ${data.projectPct.toFixed(1)}%` : '') +
          (data.date ? `  ${data.date}` : ''),
      ),
    );
    return { stdout: lines.join('\n') + '\n', stderr: '' };
  }
  if (!data.shareUrl) {
    return { stdout: successLine('uploaded') + '\n', stderr: '' };
  }
  lines.push(successLine(`shared  ${shareUrl(data.shareUrl)}`));
  if (data.expiresAt) {
    lines.push(dim(`  expires ${data.expiresAt}`));
  }
  return { stdout: lines.join('\n') + '\n', stderr: '' };
}

/** Multi-line help when the ingest token is missing. */
export function formatMissingTokenError(opts?: {
  owner?: string | null;
  name?: string | null;
}): string {
  return errorBlock('missing ingest token', [
    ...tokenMintGuidance(opts),
    'or pass --token <token> (avoid on shared hosts: visible in ps)',
  ]);
}

/**
 * Map HTTP / API errors to human guidance. Prefer known codes
 * (repo_not_found, token_required) then fall back to status heuristics.
 */
export function formatPushError(
  status: number,
  message: string,
  code?: string,
  identity?: TokenMintIdentity,
): string {
  if (status === 0) {
    return errorBlock(message);
  }

  const normalized = (code ?? message).toLowerCase();

  if (
    normalized.includes('token_required') ||
    normalized.includes('invalid token') ||
    normalized.includes('unauthorized') ||
    normalized.includes('invalid credentials') ||
    status === 401
  ) {
    return errorBlock('ingest auth failed', [
      message,
      '',
      ...tokenMintGuidance(identity),
      'or --token',
    ]);
  }

  if (
    normalized.includes('repo_not_found') ||
    (status === 404 && /repo/i.test(message))
  ) {
    return errorBlock('repo not found', [
      message,
      '',
      'Check --owner / --name (or that the git remote origin is correct)',
      'and that this repo exists on app.tested.dev',
    ]);
  }

  if (status === 403) {
    return errorBlock(`ingest failed (${status})`, [
      message,
      '',
      'Token may lack permission for this repo.',
    ]);
  }

  return errorBlock(`ingest failed (${status})`, [message]);
}

export interface ExecutePushDeps {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  computeDiffFn?: typeof computeDiff;
  fetchFn?: typeof fetch;
  openRepoFn?: (cwd: string) => Promise<GitContext>;
  loadConfigFn?: typeof loadConfig;
  /** Progress writer (defaults to stderr). Tests may capture or no-op. */
  onProgress?: (msg: string) => void;
}

/**
 * Full `tested push` orchestration. Injectable deps keep unit tests free of
 * real git / network / coverage files.
 */
export async function executePush(
  cli: PushCliOpts,
  deps: ExecutePushDeps,
): Promise<PushResult> {
  const env = deps.env ?? process.env;
  const computeDiffFn = deps.computeDiffFn ?? computeDiff;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const openRepoFn = deps.openRepoFn ?? openRepo;
  const loadConfigFn = deps.loadConfigFn ?? loadConfig;
  const onProgress =
    deps.onProgress ??
    ((msg: string) => {
      process.stderr.write(progress(msg) + '\n');
    });

  const token = resolveToken({
    ...(cli.token !== undefined ? { flag: cli.token } : {}),
    env,
  });
  if (!token) {
    let owner = cli.owner ?? null;
    let name = cli.name ?? null;
    if (!owner || !name) {
      try {
        const ctx = await openRepoFn(deps.cwd);
        const origin = await remoteUrl(ctx, 'origin');
        const parsed = parseGitHubRemote(origin);
        if (parsed) {
          owner = owner ?? parsed.owner;
          name = name ?? parsed.name;
        }
      } catch {
        // Keep the URL shape when origin is unavailable.
      }
    }
    return {
      exitCode: 1,
      stdout: '',
      stderr: formatMissingTokenError({ owner, name }),
    };
  }

  let prNumber: number | null;
  try {
    prNumber = resolvePrNumber({
      ...(cli.pr !== undefined ? { flag: cli.pr } : {}),
      env,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: '', stderr: errorBlock(message) };
  }
  const mainline = Boolean(cli.mainline);
  if (prNumber === null && !mainline) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: errorBlock('PR number required', [
        'Pass --pr <number>',
        'or set GITHUB_PR_NUMBER (CI) / PR_NUMBER',
        'or pass --mainline for default-branch coverage (no share URL)',
      ]),
    };
  }

  let apiBase: string;
  try {
    apiBase = resolveApiBase({
      ...(cli.url !== undefined ? { flag: cli.url } : {}),
      env,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: '', stderr: errorBlock(message) };
  }
  let merge: CoverageMergeState;
  try {
    merge = resolveCoverageMerge(cli, env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: '', stderr: errorBlock(message) };
  }
  const coverageMerge = toCoverageMergePayload(merge);

  const config: TestedConfig = await loadConfigFn({ cwd: deps.cwd });
  const ctx = await openRepoFn(deps.cwd);
  const peeked = await peekRepoIdentity({
    ...(cli.owner !== undefined ? { owner: cli.owner } : {}),
    ...(cli.name !== undefined ? { name: cli.name } : {}),
    env,
    ctx,
  });

  const coveragePaths = resolveCoveragePaths({
    ...(cli.file && cli.file.length > 0 ? { files: cli.file } : {}),
    env,
    configPath: config.coverage.path,
  });
  const existingCoverage = existingCoveragePaths(coveragePaths, deps.cwd);
  const handshakeOnly =
    merge.complete &&
    existingCoverage.length === 0 &&
    (cli.complete === true || merge.totalParts !== undefined);

  let diff: DiffOutput | undefined;
  if (!handshakeOnly) {
    try {
      let baseOverride = cli.base;
      if (baseOverride === undefined && prNumber !== null) {
        const resolved = await resolvePrPushBase({
          ctx,
          requested: config.base,
          prNumber,
          ...(peeked.owner != null ? { owner: peeked.owner } : {}),
          ...(peeked.name != null ? { name: peeked.name } : {}),
          fetchFn,
          env,
          onProgress,
        });
        if (resolved !== undefined) baseOverride = resolved;
      }
      onProgress('computing diff…');
      diff = await computeDiffFn({
        cwd: deps.cwd,
        config,
        ...(baseOverride !== undefined ? { baseRef: baseOverride } : {}),
        ctx,
        ...(coveragePaths.length > 0 ? { coveragePaths } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: errorBlock(message) };
    }
  } else {
    onProgress('complete handshake (no local coverage)…');
  }

  let owner = cli.owner ?? peeked.owner ?? undefined;
  let name = cli.name ?? peeked.name ?? undefined;
  if (!owner || !name) {
    const fromActions = parseGitHubRepository(env.GITHUB_REPOSITORY);
    if (fromActions) {
      owner = owner ?? fromActions.owner;
      name = name ?? fromActions.name;
    }
  }
  if (!owner || !name) {
    let origin: string;
    try {
      origin = await remoteUrl(ctx, 'origin');
    } catch {
      return {
        exitCode: 1,
        stdout: '',
        stderr: errorBlock('could not read git remote origin', [
          'Pass --owner and --name explicitly.',
        ]),
      };
    }
    const parsed = parseGitHubRemote(origin);
    if (!parsed) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: errorBlock(
          `could not parse owner/name from remote "${redactGitRemote(origin)}"`,
          ['Pass --owner and --name.'],
        ),
      };
    }
    owner = owner ?? parsed.owner;
    name = name ?? parsed.name;
  }

  const sha = await headSha(ctx);
  const branch = (await currentBranch(ctx)) || 'coverage push';

  const baseRef = cli.baseRef ?? (toBranchName(config.base) || 'main');
  const headRef = cli.headRef ?? branch;
  const prTitle = cli.prTitle ?? (branch !== 'coverage push' ? branch : 'coverage push');

  let author = cli.author;
  if (!author) {
    const gitName = await gitUserName(ctx);
    author = sanitizeAuthor(gitName ?? env.USER ?? env.USERNAME ?? 'unknown');
  }

  let testReport: TestReport | undefined;
  try {
    const junitPath = resolveJunitPath({
      ...(cli.junit !== undefined ? { flag: cli.junit } : {}),
      cwd: deps.cwd,
      env,
    });
    if (junitPath) {
      onProgress(`parsing JUnit (${junitPath})…`);
      testReport = loadTestReportFromJunit(junitPath);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: '', stderr: errorBlock(message) };
  }

  const mergeFields = {
    coverageMerge,
    ...(diff ? { diff } : {}),
    ...(testReport ? { testReport } : {}),
  };

  const body = mainline
    ? buildMainlineIngestBody({
        owner,
        name,
        defaultBranch: baseRef,
        headSha: sha,
        ref: `refs/heads/${baseRef}`,
        runUrl: cli.runUrl ?? null,
        ...mergeFields,
      })
    : buildIngestBody({
        owner,
        name,
        baseRef,
        prNumber: prNumber as number,
        prTitle,
        author,
        headRef,
        headSha: sha,
        runUrl: cli.runUrl ?? null,
        ...mergeFields,
      });

  onProgress(
    !merge.complete
      ? 'uploading shard (incomplete)…'
      : mainline
        ? 'uploading mainline coverage…'
        : handshakeOnly
          ? 'sending complete handshake…'
          : 'uploading…',
  );
  const result = await postIngest({ apiBase, token, body, fetchFn });
  if (!result.ok) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: formatPushError(result.status, result.message, result.code, {
        owner,
        name,
      }),
    };
  }

  const formatted = formatPushSuccess(result.data, cli.json, merge);
  return {
    exitCode: 0,
    stdout: formatted.stdout,
    stderr: formatted.stderr,
    complete: merge.complete,
    ...(result.data.shareUrl !== undefined ? { shareUrl: result.data.shareUrl } : {}),
    ...(result.data.expiresAt !== undefined
      ? { expiresAt: result.data.expiresAt }
      : {}),
  };
}

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local coverage to tested.dev and get a share URL')
    .option(
      '--token <token>',
      'Ingest token (prefer env TESTED_TOKEN / TESTED_INGEST_TOKEN / TESTED_TOKEN_FILE)',
    )
    .option(
      '--url <url>',
      `API base URL (default ${DEFAULT_API_BASE}, or env TESTED_API_URL)`,
    )
    .option('--owner <owner>', 'Repo owner (default: detect from git remote origin)')
    .option('--name <name>', 'Repo name (default: detect from git remote origin)')
    .option('--pr <number>', 'PR number (or env GITHUB_PR_NUMBER / PR_NUMBER)')
    .option(
      '--mainline',
      'Upload default-branch project coverage only (no PR / no share URL)',
      false,
    )
    .option('--pr-title <title>', 'PR title (default: current branch or "coverage push")')
    .option(
      '--author <login>',
      'PR author login (default: git user.name sanitized or $USER)',
    )
    .option(
      '--base-ref <ref>',
      'Base branch name sent to the API (default: .tested.yaml base or main)',
    )
    .option('--head-ref <ref>', 'Head branch name (default: current branch)')
    .option('--run-url <url>', 'Optional CI run URL attached to the ingest')
    .option('--base <ref>', 'Git base ref to diff against (same as `tested diff --base`)')
    .option(
      '--junit <path>',
      'JUnit XML for test analytics (flakes / slowest). Also TESTED_JUNIT or auto-detect junit.xml / test-results/junit.xml / coverage/junit.xml',
    )
    .option(
      '--file <path>',
      'Coverage file to merge (repeatable). Overrides coverage.path.',
      collectCoverageFile,
      [],
    )
    .option('--complete', 'Conclude the gate (last shard / finish job)', false)
    .option('--incomplete', 'Upload a shard without concluding GitHub checks', false)
    .option('--parts <n>', 'Total shard count (Codecov after_n_builds / Qlty total-parts-count)')
    .option('--part <n>', '1-based shard index')
    .option('--run-id <id>', 'CI run id grouping shards for one SHA (or TESTED_RUN_ID)')
    .option('--shard <id>', 'Optional shard label (or TESTED_SHARD)')
    .option('--json', 'Emit machine-readable JSON instead of the share URL only', false)
    .action(async (opts: PushCliOpts) => {
      try {
        const result = await executePush(opts, { cwd: process.cwd() });
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.stdout) process.stdout.write(result.stdout);
        // NB: use exitCode (not process.exit) so buffered stdout fully flushes.
        process.exitCode = result.exitCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(errorBlock(message));
        process.exitCode = 1;
      }
    });
}
