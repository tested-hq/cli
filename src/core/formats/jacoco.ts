import {
  fileCoverageFromLineHits,
  mergeLineHits,
  type FileCoverage,
} from '../coverage-model.js';
import { xmlAttr } from './xml.js';

/**
 * Parse JaCoCo XML (`jacoco.xml` from Maven/Gradle).
 *
 * Path = package name + sourcefile name. Hits = covered instructions (`ci`).
 * A line with `ci="0"` is uncovered even when `mi` (missed) is non-zero.
 */
export function parseJacoco(raw: string, repoRoot: string): FileCoverage[] {
  const byFile = new Map<string, Map<number, number>>();

  const pkgRe = /<package\b([^>]*)>([\s\S]*?)<\/package>/gi;
  let pkgMatch: RegExpExecArray | null;
  while ((pkgMatch = pkgRe.exec(raw)) !== null) {
    const pkgName = xmlAttr(pkgMatch[1] ?? '', 'name')?.trim() ?? '';
    const pkgPath = normalizePackagePath(pkgName);
    const body = pkgMatch[2] ?? '';
    const sfRe = /<sourcefile\b([^>]*)>([\s\S]*?)<\/sourcefile>/gi;
    let sfMatch: RegExpExecArray | null;
    while ((sfMatch = sfRe.exec(body)) !== null) {
      const sourceName = xmlAttr(sfMatch[1] ?? '', 'name')?.trim();
      if (!sourceName) continue;
      const path = pkgPath ? `${pkgPath}/${sourceName}` : sourceName;
      let hits = byFile.get(path);
      if (!hits) {
        hits = new Map();
        byFile.set(path, hits);
      }
      const lineRe = /<line\b([^>]*)\/?>/gi;
      let lineMatch: RegExpExecArray | null;
      while ((lineMatch = lineRe.exec(sfMatch[2] ?? '')) !== null) {
        const lineAttrs = lineMatch[1] ?? '';
        const nr = Number(xmlAttr(lineAttrs, 'nr'));
        const ci = Number(xmlAttr(lineAttrs, 'ci') ?? '0');
        // Covered-instruction count is the hit signal. Using `mi` would invert
        // covered/uncovered lines.
        mergeLineHits(hits, nr, Number.isFinite(ci) ? ci : 0);
      }
    }
  }

  const out: FileCoverage[] = [];
  for (const [path, hits] of byFile) {
    const file = fileCoverageFromLineHits(repoRoot, path, hits);
    if (file) out.push(file);
  }
  return out;
}

function normalizePackagePath(name: string): string {
  if (!name) return '';
  if (name.includes('/')) return name.replace(/\\/g, '/');
  return name.replace(/\./g, '/');
}
