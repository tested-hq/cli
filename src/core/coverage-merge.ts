/**
 * Shard / matrix handshake for coverage ingest.
 *
 * Codecov `after_n_builds` behavior: do not conclude the patch/project gate
 * until every expected shard is in (or a finish job sends `--complete`).
 *
 * Qlty-style `incomplete` + `complete` / `total-parts-count`:
 *   - `tested push --parts 3 --part 1`  → coverageMerge.complete = false
 *   - `tested push --parts 3 --part 3`  → coverageMerge.complete = true
 *   - `tested push --complete`          → coverageMerge.complete = true
 *
 * App follow-up (tested-hq/app `POST /api/ingest`): honor `coverageMerge`.
 * When `complete` is false, store the shard and do NOT post GitHub checks,
 * PR comments, or a passing/failing gate. Missing shards fail or stay
 * pending — no carryforward.
 */

export interface CoverageMergeCli {
  complete?: boolean;
  incomplete?: boolean;
  parts?: string;
  part?: string;
  runId?: string;
  shard?: string;
}

export interface CoverageMergeState {
  /** When false, GitHub checks / PR comment / gate must not conclude. */
  complete: boolean;
  totalParts?: number;
  part?: number;
  runId?: string;
  shard?: string;
}

/** Ingest payload extension for tested-hq/app. */
export interface CoverageMergePayload {
  complete: boolean;
  totalParts?: number;
  part?: number;
  runId?: string;
  shard?: string;
}

function emptyToUndef(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(raw: string | undefined, label: string): number | undefined {
  const trimmed = emptyToUndef(raw);
  if (trimmed === undefined) return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`invalid ${label} "${raw}" — expected a positive integer`);
  }
  return n;
}

/**
 * Resolve whether this upload/check concludes the coverage gate.
 *
 * - `--complete` wins (finish job).
 * - `--incomplete` never concludes.
 * - `--parts N` without `--part` is incomplete (finish job must `--complete`).
 * - `--parts N --part N` is the last shard and concludes.
 * - `--parts N --part i` (i < N) is incomplete.
 * - No shard flags: single upload, concludes (today's behavior).
 */
export function resolveCoverageMerge(
  cli: CoverageMergeCli,
  env: NodeJS.ProcessEnv = process.env,
): CoverageMergeState {
  if (cli.complete && cli.incomplete) {
    throw new Error('cannot pass both --complete and --incomplete');
  }

  const totalParts = parsePositiveInt(cli.parts ?? env.TESTED_PARTS, '--parts');
  const part = parsePositiveInt(cli.part ?? env.TESTED_PART, '--part');
  const runId = emptyToUndef(cli.runId ?? env.TESTED_RUN_ID);
  const shard = emptyToUndef(cli.shard ?? env.TESTED_SHARD);

  if (part !== undefined && totalParts !== undefined && part > totalParts) {
    throw new Error(`--part ${part} is greater than --parts ${totalParts}`);
  }

  let complete: boolean;
  if (cli.complete) {
    complete = true;
  } else if (cli.incomplete) {
    complete = false;
  } else if (totalParts !== undefined) {
    complete = part !== undefined && part === totalParts;
  } else {
    complete = true;
  }

  const state: CoverageMergeState = { complete };
  if (totalParts !== undefined) state.totalParts = totalParts;
  if (part !== undefined) state.part = part;
  if (runId !== undefined) state.runId = runId;
  if (shard !== undefined) state.shard = shard;
  return state;
}

export function toCoverageMergePayload(state: CoverageMergeState): CoverageMergePayload {
  const payload: CoverageMergePayload = { complete: state.complete };
  if (state.totalParts !== undefined) payload.totalParts = state.totalParts;
  if (state.part !== undefined) payload.part = state.part;
  if (state.runId !== undefined) payload.runId = state.runId;
  if (state.shard !== undefined) payload.shard = state.shard;
  return payload;
}

/** True when shard flags were used (app should persist coverageMerge). */
export function hasShardMetadata(state: CoverageMergeState): boolean {
  return (
    !state.complete ||
    state.totalParts !== undefined ||
    state.part !== undefined ||
    state.runId !== undefined ||
    state.shard !== undefined
  );
}

export function formatIncompleteGateMessage(state: CoverageMergeState): string {
  const part =
    state.part !== undefined && state.totalParts !== undefined
      ? `part ${state.part} of ${state.totalParts}`
      : state.totalParts !== undefined
        ? `waiting for ${state.totalParts} parts`
        : 'incomplete shard';
  return (
    `coverage shard is incomplete (${part}). ` +
    'The patch/project gate runs only on --complete or the last part.'
  );
}
