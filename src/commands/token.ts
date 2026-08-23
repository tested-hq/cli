import { Command } from 'commander';
import { openRepo, remoteUrl } from '../git.js';
import {
  INGEST_TOKEN_ENV_NAMES,
  ingestTokenSettingsUrl,
  tokenMintGuidance,
} from '../token-help.js';
import { parseGitHubRemote, resolveToken } from './push.js';
import { dim, errorBlock, formatCliError, heading } from '../output/ui.js';

export type TokenSource =
  | 'TESTED_TOKEN'
  | 'TESTED_INGEST_TOKEN'
  | 'TESTED_TOKEN_FILE'
  | 'token'
  | null;

export interface RepoIdentity {
  owner: string | null;
  name: string | null;
}

export async function resolveRepoIdentity(opts: {
  cwd: string;
  openRepoFn?: typeof openRepo;
  remoteUrlFn?: typeof remoteUrl;
}): Promise<RepoIdentity> {
  try {
    const open = opts.openRepoFn ?? openRepo;
    const getUrl = opts.remoteUrlFn ?? remoteUrl;
    const ctx = await open(opts.cwd);
    const url = await getUrl(ctx, 'origin');
    const parsed = parseGitHubRemote(url);
    return parsed ?? { owner: null, name: null };
  } catch {
    return { owner: null, name: null };
  }
}

export function tokenSourceFromEnv(env: NodeJS.ProcessEnv): TokenSource {
  if (env.TESTED_TOKEN) return 'TESTED_TOKEN';
  if (env.TESTED_INGEST_TOKEN) return 'TESTED_INGEST_TOKEN';
  if (env.TESTED_TOKEN_FILE) return 'TESTED_TOKEN_FILE';
  return 'token';
}

export function formatTokenHuman(identity: RepoIdentity): string {
  const lines = [
    heading('tested.dev — token'),
    '',
    ...tokenMintGuidance(identity).map((line) => dim(`  ${line}`)),
    '',
  ];
  return lines.join('\n');
}

export function formatTokenJson(identity: RepoIdentity): string {
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        mintUrl: ingestTokenSettingsUrl(identity.owner, identity.name),
        envNames: [...INGEST_TOKEN_ENV_NAMES],
        owner: identity.owner,
        name: identity.name,
      },
      null,
      2,
    ) + '\n'
  );
}

export interface WhoamiResult {
  tokenSet: boolean;
  source: TokenSource;
  identity: RepoIdentity;
  exitCode: 0 | 1;
}

export function formatWhoamiHuman(result: WhoamiResult): string {
  const lines = [heading('tested.dev — whoami'), ''];
  if (result.tokenSet) {
    lines.push(dim(`  token: set via ${result.source} (value not shown)`));
  } else {
    lines.push(dim('  token: not set'));
    for (const line of tokenMintGuidance(result.identity)) {
      lines.push(dim(`  ${line}`));
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function formatWhoamiJson(result: WhoamiResult): string {
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        tokenSet: result.tokenSet,
        source: result.source,
        mintUrl: ingestTokenSettingsUrl(result.identity.owner, result.identity.name),
        envNames: [...INGEST_TOKEN_ENV_NAMES],
      },
      null,
      2,
    ) + '\n'
  );
}

export async function runToken(opts: {
  cwd: string;
  json?: boolean;
  openRepoFn?: typeof openRepo;
  remoteUrlFn?: typeof remoteUrl;
}): Promise<{ stdout: string; exitCode: 0 }> {
  const identity = await resolveRepoIdentity(opts);
  const stdout = opts.json ? formatTokenJson(identity) : formatTokenHuman(identity);
  return { stdout, exitCode: 0 };
}

export async function runWhoami(opts: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  json?: boolean;
  openRepoFn?: typeof openRepo;
  remoteUrlFn?: typeof remoteUrl;
  resolveTokenFn?: typeof resolveToken;
}): Promise<{ stdout: string; stderr: string; exitCode: 0 | 1 }> {
  const env = opts.env ?? process.env;
  const identity = await resolveRepoIdentity(opts);
  const resolve = opts.resolveTokenFn ?? resolveToken;
  let tokenSet = false;
  let source: TokenSource = null;
  try {
    const token = resolve({ env, isTTY: false, warn: () => {} });
    tokenSet = Boolean(token);
    source = tokenSet ? tokenSourceFromEnv(env) : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: '',
      stderr: formatCliError(message),
      exitCode: 1,
    };
  }
  const result: WhoamiResult = { tokenSet, source, identity, exitCode: tokenSet ? 0 : 1 };
  const stdout = opts.json ? formatWhoamiJson(result) : formatWhoamiHuman(result);
  return { stdout, stderr: '', exitCode: result.exitCode };
}

export function registerTokenCommand(program: Command): void {
  program
    .command('token')
    .description('Print the ingest-token mint URL and accepted env names')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (opts: { json: boolean }) => {
      try {
        const result = await runToken({ cwd: process.cwd(), json: opts.json });
        process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : result.stdout + '\n');
        process.exitCode = result.exitCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(formatCliError(message));
        process.exitCode = 1;
      }
    });
}

export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Report whether an ingest token is set (never prints the value)')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (opts: { json: boolean }) => {
      try {
        const result = await runWhoami({ cwd: process.cwd(), json: opts.json });
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.stdout) {
          process.stdout.write(
            result.stdout.endsWith('\n') ? result.stdout : result.stdout + '\n',
          );
        }
        process.exitCode = result.exitCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(errorBlock(message));
        process.exitCode = 1;
      }
    });
}
