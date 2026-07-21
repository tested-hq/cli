# TASK: CLI visuals, feedback, and DX polish (iterate until excellent)

Branch: `feat/cli-dx-polish` (current). Repo: @tested/cli

## North star
Terminal UX that matches tested.dev product: monochrome editorial craft, agent-clear,
human-pretty. Not noisy SaaS rainbow — restrained color with picocolors (green/yellow/red
for status only). Support `NO_COLOR` / non-TTY (skip ornaments when !stdout.isTTY).

## Pain from dogfood (fix these)

### `tested diff` human report
- Flat list; long uncovered ranges wrap ugly
- No gate verdict vs thresholds
- No project delta when present
- No “next step” (run check / push)
- Patch 0/0 with “-” looks broken — explain “no executable lines in patch” when applicable

### `tested check`
- Duplicates FAIL on stderr AND stdout — pick one clear layout:
  - Header + verdict badge
  - Two metric rows with threshold comparison
  - One-line next action if fail (“add tests for uncovered ranges: tested diff”)
- Keep exit codes; keep --json shape stable (additive fields OK only if tests updated)

### Errors (push, missing coverage, etc.)
- `missing ingest token` → multi-line help:
  ```
  error: missing ingest token

    Pass --token <token>
    or set TESTED_TOKEN / TESTED_INGEST_TOKEN

    Create a token: app.tested.dev → repo → Settings → Ingest token
  ```
- Missing coverage-final.json → tell user `tested run` first
- repo_not_found / token_required from API → map HTTP errors to human guidance in push

### `tested init` next steps
Update to the real agent loop:
1. `tested run`
2. `tested diff`
3. `tested push --pr <n>` (with token)
4. optional CI

### `tested push`
- Progress: “computing diff…”, “uploading…”, then success with share URL bold/cyan
- On success print expiresAt dim if present
- Don’t dump stack traces

### `tested run`
- Prefixed banner: `tested.dev — running tests with coverage` before spawning
- After success: one-line tip `→ tested diff` / `→ tested check`
- On failure: clear exit, still mention coverage file if written

### `tested explain`
- Slightly clearer header; keep compact

### Root `--help`
- Better description: one-liner + suggested flow in help text if commander allows
- Order commands by workflow: init, run, diff, check, push, explain, ignores

## Implementation plan
1. Add `src/output/ui.ts` shared helpers:
   - `isColorEnabled()`, `badge(pass|fail|warn|info)`, `metricBar(pct, width?)`, `heading`, `dim`, `errorBlock(title, lines[])`, `successLine`, `nextSteps(steps[])`
   - Keep pure / testable where possible
2. Rewrite `src/output/human.ts` using ui helpers + optional thresholds from config when available
   - `formatHuman(out, opts?: { thresholds?: {patch, project}, tips?: boolean })`
3. Wire diff/check/init/push/run/explain to use shared UI
4. Update unit tests for human output + check + push error formatting
5. README: short “Terminal UX” / agent loop section

## Quality bar
- `pnpm test` green
- `pnpm typecheck` green  
- `pnpm build` green
- Manually sensible on a sample repo (you can run if easy)
- Commit on branch with clear message
- Prefer 1–2 focused commits if you iterate

## Style constraints
- No new heavy deps (picocolors already there)
- Don’t break JSON schemas for agents
- Don’t change computeDiff math
- ASCII-safe ornaments preferred (box drawing optional if looks good in monochrome)
