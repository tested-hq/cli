import { describe, expect, it } from 'vitest';
import {
  formatIncompleteGateMessage,
  hasShardMetadata,
  resolveCoverageMerge,
  toCoverageMergePayload,
} from '../../src/core/coverage-merge.js';

describe('resolveCoverageMerge', () => {
  it('concludes a single upload (no shard flags)', () => {
    const state = resolveCoverageMerge({}, {});
    expect(state).toEqual({ complete: true });
    expect(hasShardMetadata(state)).toBe(false);
    expect(toCoverageMergePayload(state)).toEqual({ complete: true });
  });

  it('does not conclude shard 1 of N', () => {
    const state = resolveCoverageMerge({ parts: '3', part: '1' }, {});
    expect(state.complete).toBe(false);
    expect(state.totalParts).toBe(3);
    expect(state.part).toBe(1);
    expect(hasShardMetadata(state)).toBe(true);
    expect(toCoverageMergePayload(state).complete).toBe(false);
  });

  it('concludes on the last part', () => {
    const state = resolveCoverageMerge({ parts: '3', part: '3' }, {});
    expect(state.complete).toBe(true);
    expect(state.totalParts).toBe(3);
    expect(state.part).toBe(3);
  });

  it('stays incomplete when parts is set without part (finish job must --complete)', () => {
    const state = resolveCoverageMerge({ parts: '2' }, {});
    expect(state.complete).toBe(false);
    expect(state.totalParts).toBe(2);
    expect(state.part).toBeUndefined();
  });

  it('--complete wins over parts without part', () => {
    const state = resolveCoverageMerge({ complete: true, parts: '4' }, {});
    expect(state.complete).toBe(true);
    expect(state.totalParts).toBe(4);
  });

  it('--incomplete never concludes', () => {
    const state = resolveCoverageMerge({ incomplete: true, parts: '2', part: '2' }, {});
    expect(state.complete).toBe(false);
  });

  it('rejects both --complete and --incomplete', () => {
    expect(() => resolveCoverageMerge({ complete: true, incomplete: true }, {})).toThrow(
      /both --complete and --incomplete/,
    );
  });

  it('rejects part greater than parts', () => {
    expect(() => resolveCoverageMerge({ parts: '2', part: '3' }, {})).toThrow(/greater than/);
  });

  it('reads parts / run-id / shard from env', () => {
    const state = resolveCoverageMerge(
      {},
      { TESTED_PARTS: '2', TESTED_PART: '1', TESTED_RUN_ID: '99', TESTED_SHARD: 'node' },
    );
    expect(state).toEqual({
      complete: false,
      totalParts: 2,
      part: 1,
      runId: '99',
      shard: 'node',
    });
  });

  it('formatIncompleteGateMessage names the part', () => {
    const msg = formatIncompleteGateMessage({ complete: false, part: 1, totalParts: 3 });
    expect(msg).toMatch(/part 1 of 3/);
    expect(msg).toMatch(/--complete|last part/);
  });
});
