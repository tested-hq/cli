# @tested/cli

Coverage your agent can use. CLI for patch + project coverage with agent-readable JSON output.

Docs: https://tested.dev/docs

## Install

Node 24+.

```bash
pnpm add -D @tested/cli
# or
npx @tested/cli          # runs `tested` (`td` is the same CLI after install)
```

```bash
npx @tested/cli --version
# after a local install, pnpm swallows --version unless you use exec:
pnpm exec -- tested --version
```

CI uses the composite Action (`tested-hq/cli/action@main`). It installs `@tested/cli` from npm.

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.8
    token: ${{ secrets.TESTED_TOKEN }}
```

## First 10 minutes

```
tested setup            # init + doctor + CI snippet + token help
tested doctor           # environment checklist (exit 0/1)
tested run              # writes coverage even if tests fail
tested diff             # report (exit 0)
tested check            # gate (exit 1 if under threshold)
tested push --pr <n>    # needs TESTED_TOKEN
tested token            # mint URL from git remote + env names
tested whoami           # whether a token is set (never prints it)
```

## Security

> **Only point `tested` at repositories you trust.** `tested run` (and the MCP
> server’s `write_and_verify`) executes the project’s own test runner (`npx
> vitest` / jest / pytest). That is equivalent to running untrusted code when
> the cwd is untrusted.

| Control | Detail |
|---------|--------|
| Ingest token | Prefer `TESTED_TOKEN` / `TESTED_INGEST_TOKEN` / `TESTED_TOKEN_FILE` (mode `0600`). Avoid `--token` on shared hosts — it appears on process argv (`ps`). |
| Safe run args | In CI, non-interactive shells, or when `TESTED_SAFE_RUN=1`, `tested run` rejects `--watch` / `--watchAll` and `--config` paths outside the repo root. |
| API URL | Ingest posts only to `https://app.tested.dev` / `*.tested.dev` (or `http://localhost`). Other HTTPS hosts need `TESTED_ALLOW_CUSTOM_API_URL=1`. Redirects with Bearer token are refused. |
| MCP hosts | For always-on agent hosts, set `TESTED_ALLOWED_CWDS` (see `@tested/mcp`) so tools cannot target arbitrary directories. |

## Agent loop

```
tested setup                # init + doctor + CI / token guidance
tested run                  # run tests with coverage (writes coverage even if tests fail)
tested diff                 # patch + project report (exit 0; not the gate)
tested check                # enforce thresholds (exit non-zero on fail)
tested push --pr <n>        # share URL on app.tested.dev (needs token)
```

## Terminal UX

Human output is monochrome editorial craft: restrained color via picocolors (green / yellow / red for status only). ASCII badges (`[PASS]` / `[FAIL]`) and metric bars. Honors `NO_COLOR` and non-TTY (no ornaments when color is unsupported).

`--json` is available on setup, doctor, init, run, diff, check, push, token, whoami, explain, and ignores. `tested run --json` is tested's own summary (command, exit, coverage path). It is not forwarded to the test runner.

## Dogfood

This repo enforces its own coverage gate on every push via husky pre-push hook:

```
🐕 dogfood: running tested on itself...
... coverage report ...
🐕 patch coverage 87.2% >= 50% — push allowed
```

The hook runs `tested run && tested diff` against the upstream branch (or `HEAD~1` if no upstream). Blocks push if patch coverage < 50%. Override with `git push --no-verify` (don't).

## Gating

`tested diff` is a report (exit 0) even when coverage is under the yaml threshold. `tested check` is the gate: it enforces the `thresholds` block in `.tested.yaml` and exits non-zero when patch or project coverage falls below the configured floor.

```yaml
thresholds:
  patch: 80     # % of newly-added lines that must be covered
  project: 90   # % of the whole project that must be covered
```

```
$ tested check
tested.dev — coverage gate  [PASS]

  Patch     87.3%  (threshold 80)  [PASS]
  Project   92.1%  (threshold 90)  [PASS]

thresholds met
$ echo $?
0

$ tested check
tested.dev — coverage gate  [FAIL]

  Patch     42.7%  (threshold 80)  [FAIL]
  Project   92.1%  (threshold 90)  [PASS]

→ add tests for uncovered ranges: tested diff
$ echo $?
1
```

If the patch has no executable lines in scope (tests-only, comments-only, docs-only, or ignored files), the patch gate is **skipped** — not reported as 0% coverage. Project still applies.

```
$ tested check
tested.dev — coverage gate  [PASS]

  Patch     -  no executable lines in the patch  [SKIP]
  Project   92.1%  (threshold 90)  [PASS]

No executable lines in the patch — patch gate skipped. Project threshold met.
```

If `thresholds` is missing from `.tested.yaml`, `tested check` prints a notice on stderr and exits 0 — configs that haven't opted in stay green.

### Flags (per package)

Independent floors so a monorepo total cannot hide one package. Each flag is graded from **this run's** coverage files — no carryforward.

```yaml
flags:
  frontend:
    paths: ["apps/web/**", "packages/ui/**"]
    thresholds:
      patch: 90   # inherits project from thresholds.project
  backend:
    paths: ["apps/api/**"]
```

`tested check` applies global `thresholds` plus each flag whose paths appear in the merged coverage. Per-flag patch is new executable lines in those paths. A flag with no files this run is **missing** (fail / pending) — never last week's numbers.

A job already scoped to one package: `tested check --flag frontend` (Action `flag:`). That coverage file **is** the flag.

`--json` lists per-flag results (`flags.frontend.patchCheck` → `tested.dev / patch / frontend`). `tested push` sends that same `flags` map on ingest so the app can post those GitHub checks. `tested diff --json` includes it too.

## Coverage formats

`tested diff` / `tested check` / `tested push` all read the same internal model (file path + statement hits). Parsers normalize these artifacts into that model:

| `coverage.format` | Typical path | Produced by |
|---|---|---|
| `istanbul-json` (or `v8-json`) | `coverage/coverage-final.json` | Vitest, Jest, nyc — V8 coverage emitted as Istanbul JSON |
| `lcov` | `coverage/lcov.info`, `*.lcov` | lcov, vitest lcov reporter, pytest-cov `--cov-report=lcov` |
| `cobertura` | `coverage/cobertura.xml`, `coverage.xml` | Cobertura, pytest-cov `--cov-report=xml` |
| `jacoco` | `jacoco.xml` | JaCoCo (Maven / Gradle) |
| `gcov` | `*.gcov` or a directory of them | GNU `gcov` **text** reports (not raw `.gcno` / `.gcda` notes) |
| `simplecov` | `coverage/.resultset.json` | SimpleCov (Ruby) |

When `coverage.format` is omitted, the CLI auto-detects from the filename and, if needed, the file contents. `coverage/coverage-final.json` is treated as Istanbul/V8 JSON (the default). Set format explicitly in `.tested.yaml` when you want to pin it:

```yaml
coverage:
  path: coverage/lcov.info
  format: lcov   # optional — auto-detected from lcov.info
```

Multiple files in one job are merged (union of paths, **max** hits — not averaged, not last-file-wins):

```yaml
coverage:
  path:
    - coverage/lcov.info
    - coverage/python.xml
```

Or pass `--file` repeatedly / Action `files`. A CI matrix must not conclude the gate on shard 1 of N: `tested push --parts N --part 1` sends `coverageMerge.complete: false`; only `--complete` or the last part posts checks. See the Action README on GitHub (`tested-hq/cli/action`).

`ignores` globs apply after parse, same as before.

**pytest-cov:** emit lcov or Cobertura XML (`--cov-report=lcov` / `--cov-report=xml`). coverage.py JSON is not ingested.

**gcov:** run `gcov` on your `.gcda` files in CI and point `coverage.path` at the resulting `.gcov` text (or the directory that contains them). Binary notes are not parsed.

**SimpleCov:** the default `coverage/.resultset.json` (and the `simplecov-json` gem report) are accepted. Array index 0 is line 1; `null` is non-executable.

### GitHub Actions

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.8
    push: true
    pr-number: ${{ github.event.pull_request.number }}
    token: ${{ secrets.TESTED_TOKEN }}
```

### `--json`

For programmatic consumers:

```
$ tested check --json
{"patch":{"pct":87.3,"threshold":80,"pass":true},"project":{"pct":92.1,"threshold":90,"pass":true},"overall":"pass"}
```

When `flags` are configured, `tested check --json` and `tested diff --json` include a `flags` map (status, patch/project totals, and `tested.dev / patch / <name>` slugs). `tested push` posts that same map as a sibling field on the ingest body.

`--json` suppresses the human layout; the exit code is unchanged.

## Share (`tested push`)

Push local patch/project coverage to [tested.dev](https://app.tested.dev) and get a share URL back. Closes the agent loop: local coverage → cloud link.

```
$ export TESTED_TOKEN=…          # or TESTED_INGEST_TOKEN / --token
$ export GITHUB_PR_NUMBER=42     # or --pr 42
$ tested push
✓ shared  https://app.tested.dev/share/…
  expires 2026-…
```

| Flag / env | Purpose |
|---|---|
| `TESTED_TOKEN` / `TESTED_INGEST_TOKEN` / `TESTED_TOKEN_FILE` | Ingest auth (**preferred** — not on argv) |
| `--token` | Ingest auth (works; warns on TTY; visible in `ps`) |
| `--pr` / `GITHUB_PR_NUMBER` / `PR_NUMBER` | PR number (required) |
| `--url` / `TESTED_API_URL` | API base (default `https://app.tested.dev`; other hosts need `TESTED_ALLOW_CUSTOM_API_URL=1`) |
| `--owner` / `--name` | Repo identity (default: `GITHUB_REPOSITORY`, else `origin` remote) |
| `--pr-title`, `--author`, `--base-ref`, `--head-ref` | PR metadata overrides |
| `--base` | Git base for the coverage diff (same as `tested diff --base`) |
| `--junit` / `TESTED_JUNIT` | JUnit XML for flakes / suite time (or auto-detect `junit.xml`, `test-results/junit.xml`, `coverage/junit.xml`) |
| `--run-url` | Optional CI run URL |
| `--file` | Coverage file to merge (repeatable) |
| `--parts` / `--part` / `--complete` / `--incomplete` | Matrix shard handshake (`coverageMerge`) |
| `--run-id` / `--shard` | Group shards for one CI run + SHA |
| `--json` | Machine output: `{ "shareUrl", "expiresAt?" }` |

### `tested run` extra args

`tested run` writes `coverage/coverage-final.json` even when the suite fails (Vitest `--coverage.reportOnFailure`). Extra args are forwarded to the runner via argv (no shell). `--json` is consumed by tested and is not forwarded.

In CI / non-interactive mode / when `TESTED_SAFE_RUN=1`:

- `--watch`, `--watchAll`, `-w` are **rejected** (hang risk)
- `--config` / `-c` paths that resolve **outside the repo root** are **rejected**

Typical CI step after `tested check`:

```yaml
- run: pnpm exec tested push --pr "${{ github.event.pull_request.number }}" --base "${{ github.event.pull_request.base.sha }}"
  env:
    TESTED_TOKEN: ${{ secrets.TESTED_TOKEN }}
```
