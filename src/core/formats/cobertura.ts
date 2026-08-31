import {
  fileCoverageFromLineHits,
  mergeLineHits,
  type FileCoverage,
} from '../coverage-model.js';
import { xmlAttr } from './xml.js';

/**
 * Parse Cobertura XML (pytest-cov `--cov-report=xml`, Cobertura, coverage.py).
 *
 * Hits come from `<line number="N" hits="H"/>` under each `<class>`.
 */
export function parseCobertura(raw: string, repoRoot: string): FileCoverage[] {
  const byFile = new Map<string, Map<number, number>>();

  const classRe =
    /<class\b([^>]*)>([\s\S]*?)<\/class>|<class\b([^>]*)\s*\/>/gi;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRe.exec(raw)) !== null) {
    const attrs = (classMatch[1] ?? classMatch[3] ?? '').trim();
    const body = classMatch[2] ?? '';
    const filename = xmlAttr(attrs, 'filename')?.trim();
    const name = xmlAttr(attrs, 'name')?.trim();
    const path = classPath(filename, name);
    if (!path) continue;
    let hits = byFile.get(path);
    if (!hits) {
      hits = new Map();
      byFile.set(path, hits);
    }
    const lineRe = /<line\b([^>]*)\/?>/gi;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRe.exec(body)) !== null) {
      const lineAttrs = lineMatch[1] ?? '';
      const number = Number(xmlAttr(lineAttrs, 'number'));
      const hitCount = Number(xmlAttr(lineAttrs, 'hits') ?? '0');
      mergeLineHits(hits, number, hitCount);
    }
  }

  const out: FileCoverage[] = [];
  for (const [path, hits] of byFile) {
    const file = fileCoverageFromLineHits(repoRoot, path, hits);
    if (file) out.push(file);
  }
  return out;
}

function classPath(
  filename: string | undefined,
  name: string | undefined,
): string | null {
  if (filename) {
    if (filename.includes('/') || filename.includes('\\')) return filename;
    if (name && name.includes('.')) {
      const dir = name.split('.').slice(0, -1).join('/');
      return dir ? `${dir}/${filename}` : filename;
    }
    return filename;
  }
  if (name) return name.replace(/\./g, '/');
  return null;
}
