import { minimatch } from 'minimatch';

export function isIgnored(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => {
    // Support both absolute patterns (migrations/**) and patterns with wildcards
    // Try matching the pattern as-is first, then try with **/ prefix for partial matches
    return minimatch(path, p, { dot: true, matchBase: true }) ||
           minimatch(path, `**/${p}`, { dot: true, matchBase: true });
  });
}

export function splitByIgnore(
  paths: readonly string[],
  patterns: readonly string[],
): { kept: string[]; ignored: string[] } {
  const kept: string[] = [];
  const ignored: string[] = [];
  for (const p of paths) {
    if (isIgnored(p, patterns)) ignored.push(p);
    else kept.push(p);
  }
  return { kept, ignored };
}
