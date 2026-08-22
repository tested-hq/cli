/** Env names that can supply an ingest token. Never print values. */
export const INGEST_TOKEN_ENV_NAMES = [
  'TESTED_TOKEN',
  'TESTED_TOKEN_FILE',
  'TESTED_INGEST_TOKEN',
] as const;

/** Mint URL when owner/name are unknown. */
export const INGEST_TOKEN_SETTINGS_URL_SHAPE =
  'https://app.tested.dev/repos/{owner}/{name}/settings';

const GITHUB_NAME_RE = /^[\w.-]+$/;

/**
 * Settings page where an ingest token is minted.
 * Fills owner/name when they look like GitHub slugs; otherwise the shape.
 */
export function ingestTokenSettingsUrl(
  owner?: string | null,
  name?: string | null,
): string {
  if (owner && name && GITHUB_NAME_RE.test(owner) && GITHUB_NAME_RE.test(name)) {
    return `https://app.tested.dev/repos/${owner}/${name}/settings`;
  }
  return INGEST_TOKEN_SETTINGS_URL_SHAPE;
}

/** Guidance lines for missing / invalid ingest token. No secrets. */
export function tokenMintGuidance(opts?: {
  owner?: string | null;
  name?: string | null;
}): string[] {
  return [
    `Mint: ${ingestTokenSettingsUrl(opts?.owner, opts?.name)}`,
    `Set ${INGEST_TOKEN_ENV_NAMES.join(' / ')}`,
  ];
}
