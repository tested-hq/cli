import type { FileCoverage } from '../core/istanbul.js';
import { computePatchCoverage, isEmptyPatch } from '../core/patch.js';
import { computeProjectCoverage } from '../core/project.js';
import { uncoveredRanges } from '../core/uncovered.js';
import type { DiffOutput, FileCoverage as FileCoverageOut } from '../schemas.js';

export interface BuildDiffOutputArgs {
  base: string;
  head: string;
  files: readonly FileCoverage[];
  addedByFile: ReadonlyMap<string, ReadonlySet<number>>;
  ignored: readonly string[];
  projectDelta?: number | null;
}

export function buildDiffOutput(args: BuildDiffOutputArgs): DiffOutput {
  const patch = computePatchCoverage(args.files, args.addedByFile);
  const project = computeProjectCoverage(args.files);

  const emptyPatch = isEmptyPatch(patch.totals);
  // An empty patch (tests-only / docs / comments / ignored) has no files in
  // scope. Listing the whole project here made 0/0 look like a coverage miss.
  const fileNames = new Set<string>(
    emptyPatch ? [] : [...patch.byFile.keys(), ...project.byFile.keys()],
  );

  const files: FileCoverageOut[] = [];
  for (const name of fileNames) {
    const file = args.files.find((f) => f.path === name);
    if (!file) continue;
    files.push({
      path: name,
      patchCoverage: patch.byFile.get(name)?.pct ?? null,
      projectCoverage: project.byFile.get(name)?.pct ?? 0,
      uncoveredRanges: uncoveredRanges(file),
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    base: args.base,
    head: args.head,
    patch: emptyPatch ? { ...patch.totals, empty: true as const } : patch.totals,
    project: { ...project.totals, delta: args.projectDelta ?? null },
    files,
    ignored: [...args.ignored],
  };
}
