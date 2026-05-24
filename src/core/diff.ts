const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+?)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(text: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  const lines = text.split('\n');
  let currentFile: string | null = null;
  let currentLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const fileMatch = line.match(FILE_HEADER);
    if (fileMatch) {
      currentFile = fileMatch[2] ?? null;
      inHunk = false;
      continue;
    }
    if (!currentFile) continue;

    const hunkMatch = line.match(HUNK_HEADER);
    if (hunkMatch) {
      currentLine = Number(hunkMatch[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (!result.has(currentFile)) result.set(currentFile, new Set());
      result.get(currentFile)!.add(currentLine);
      currentLine += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // removed line: do not advance currentLine
    } else if (line.startsWith(' ') || line === '') {
      currentLine += 1;
    }
  }
  return result;
}
