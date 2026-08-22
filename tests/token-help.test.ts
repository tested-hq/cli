import { describe, it, expect } from 'vitest';
import {
  INGEST_TOKEN_ENV_NAMES,
  INGEST_TOKEN_SETTINGS_URL_SHAPE,
  ingestTokenSettingsUrl,
  tokenMintGuidance,
} from '../src/token-help.js';

describe('ingestTokenSettingsUrl', () => {
  it('uses the shape when owner/name are missing', () => {
    expect(ingestTokenSettingsUrl()).toBe(INGEST_TOKEN_SETTINGS_URL_SHAPE);
    expect(ingestTokenSettingsUrl('acme', null)).toBe(
      INGEST_TOKEN_SETTINGS_URL_SHAPE,
    );
  });

  it('fills a concrete settings URL for GitHub slugs', () => {
    expect(ingestTokenSettingsUrl('acme', 'demo')).toBe(
      'https://app.tested.dev/repos/acme/demo/settings',
    );
  });

  it('rejects values that are not GitHub slugs', () => {
    expect(ingestTokenSettingsUrl('acme/evil', 'demo')).toBe(
      INGEST_TOKEN_SETTINGS_URL_SHAPE,
    );
  });
});

describe('tokenMintGuidance', () => {
  it('lists mint URL and all token env names', () => {
    const lines = tokenMintGuidance();
    expect(lines.join('\n')).toContain(INGEST_TOKEN_SETTINGS_URL_SHAPE);
    for (const name of INGEST_TOKEN_ENV_NAMES) {
      expect(lines.join('\n')).toContain(name);
    }
    expect(INGEST_TOKEN_ENV_NAMES).toEqual([
      'TESTED_TOKEN',
      'TESTED_TOKEN_FILE',
      'TESTED_INGEST_TOKEN',
    ]);
  });
});
