# @tested/cli

Patch and project coverage for pull requests. Same binary, same verdict on your machine, in CI, and inside an agent.

Docs: https://tested.dev/docs

## Install

Node 24+.

```bash
pnpm add -D @tested/cli
```

Or run it without installing:

```bash
npx @tested/cli --version
```

`tested` and `td` are the same binary. After a local install, use `pnpm exec -- tested --version` (pnpm swallows `--version` without the `--`).

## Quick start

```bash
cd your-project
tested setup    # writes .tested.yaml, runs doctor, prints the CI snippet
tested run      # runs your tests with coverage
tested diff     # patch and project coverage against the base branch
tested check    # exit 1 when coverage is under the thresholds
```

`diff` and `check` run locally with no account and no token.

To put the result on the PR, push it:

```bash
export TESTED_TOKEN=...   # https://app.tested.dev/repos/{owner}/{name}/settings
tested push --pr 42
```

## Commands

| Command | What it does | Exit code |
|---|---|---|
| `tested setup` | Writes `.tested.yaml` if missing, runs `doctor`, prints the CI snippet and token instructions | doctor's |
| `tested doctor` | Checks Node, git, `.tested.yaml`, coverage file, `origin`, token, API URL | 0 ok, 1 on a hard failure |
| `tested run` | Runs the test suite with coverage. Writes the coverage file even when tests fail | the runner's |
| `tested diff` | Patch and project coverage against `base`, with uncovered ranges per file | 0, even under threshold |
| `tested check` | Enforces `thresholds` | 0 pass, 1 fail |
| `tested push` | Uploads coverage (and JUnit, if present) to tested.dev | 0 ok, 1 error |

Also: `init`, `token`, `whoami`, `explain <file>:<line>`, `ignores`.

Every command takes `--json`. Output is one JSON document on stdout; exit codes do not change. `tested run --json` is tested's own summary (command, exit code, coverage path) and is not forwarded to the test runner.

## Configure

`tested setup` writes `.tested.yaml`:

```yaml
base: main
testRunner: vitest        # vitest | jest | pytest
thresholds:
  patch: 80               # % of added executable lines that must be covered
  project: 90             # % of the whole project
ignores:
  - "**/*.test.ts"
  - "**/node_modules/**"
```

### Path floors

`thresholds.paths` holds parts of the tree to their own floor. Omitted `patch` or `project` inherit the global values.

```yaml
thresholds:
  patch: 80
  project: 90
  paths:
    - glob: "src/core/**"
      patch: 95
    - glob: "src/output/**"
      project: 70
```

Each glob is graded from the coverage files in this run. A glob that matches no files this run is skipped. Path floors are available on every plan.

### Flags

Per-package floors for a monorepo. Same rules as path floors, plus a name the app posts as its own PR check (`tested.dev / patch / frontend`).

```yaml
flags:
  frontend:
    paths: ["apps/web/**", "packages/ui/**"]
    thresholds:
      patch: 90             # project inherits thresholds.project
  backend:
    paths: ["apps/api/**"]
```

A job that only builds one package: `tested check --flag frontend` (Action input `flag`). That coverage file is the flag. Other packages are left out of the upload, and a flag with no files this run is skipped.

## What gates the PR

Coverage is the only PR gate. `tested check` exits 1 when patch, project, a flag, or a path floor is under its threshold. Everything else on app.tested.dev is visibility: the Tests and Performance tabs show failures, retries, and suite time from JUnit. A flaky or slow test does not fail the PR.

Rules `check` follows:

- `diff` reports and exits 0, even under threshold. `check` gates.
- A patch with no executable lines (tests, docs, comments, ignored files) skips the patch gate. Project still applies.
- No `thresholds` in `.tested.yaml`: `check` prints a notice on stderr and exits 0.
- A flag or path glob with no files this run is skipped.

```
$ tested check
tested.dev — coverage gate  [FAIL]

  Patch     42.7%  (threshold 80)  [FAIL]
  Project   92.1%  (threshold 90)  [PASS]

→ add tests for uncovered ranges: tested diff
$ echo $?
1
```

```
$ tested check --json
{"patch":{"pct":87.3,"threshold":80,"pass":true},"project":{"pct":92.1,"threshold":90,"pass":true},"overall":"pass"}
```

With flags or path floors configured, `--json` adds `flags` (keyed by name) and `paths` (one entry per glob). Skipped entries have `status: "missing"` and `skipped: true`, with no `pct`. `tested diff --json` includes the same two fields.

## Coverage formats

Default path: `coverage/coverage-final.json`. Set `coverage.path` for anything else. The format is detected from the filename and contents; set `coverage.format` to pin it.

| `coverage.format` | Typical path | From |
|---|---|---|
| `istanbul-json` (alias `v8-json`) | `coverage/coverage-final.json` | Vitest, Jest, nyc |
| `lcov` | `coverage/lcov.info` | lcov, Vitest `lcov` reporter, pytest-cov `--cov-report=lcov` |
| `cobertura` | `coverage/cobertura.xml`, `coverage.xml` | Cobertura, pytest-cov `--cov-report=xml` |
| `jacoco` | `jacoco.xml` | JaCoCo (Maven, Gradle) |
| `gcov` | `*.gcov`, or a directory of them | `gcov` text reports |
| `simplecov` | `coverage/.resultset.json` | SimpleCov |

Several files in one job merge into one report: union of paths, max hits per line.

```yaml
coverage:
  path:
    - coverage/lcov.info
    - coverage/python.xml
```

Or pass `--file` (repeatable) to `diff`, `check`, and `push`. Action input: `files`.

- pytest-cov: emit lcov or Cobertura XML. coverage.py JSON is not read.
- gcov: run `gcov` on the `.gcda` files first and point at the `.gcov` text. `.gcno` and `.gcda` are not parsed.
- SimpleCov: `coverage/.resultset.json` or the `simplecov-json` gem output.

JUnit XML is separate from coverage. `tested push` picks up `junit.xml`, `test-results/junit.xml`, `coverage/junit.xml`, or `reports/junit.xml` (or `--junit <path>` / `TESTED_JUNIT`) and sends failures, retries, and durations to the Tests tab.

## GitHub Action

```yaml
# .github/workflows/tested.yml
name: tested
on: [pull_request]

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm test -- --coverage
      - uses: tested-hq/cli/action@main
        with:
          version: 0.1.10
          push: true
          pr-number: ${{ github.event.pull_request.number }}
          token: ${{ secrets.TESTED_TOKEN }}
```

In production, pin `uses:` to a commit SHA and keep `version: 0.1.10`.

The Action installs `@tested/cli@<version>` from npm, resolves the base from the PR (a shallow checkout is enough), runs `tested check`, then `tested push` when `push: true`. Push runs with `continue-on-error`, so an upload problem cannot change the gate. Inputs, merged files, and matrix examples: https://github.com/tested-hq/cli/tree/main/action.

## Push to tested.dev

`tested push` uploads the report and returns a share URL for the PR. The project page at `https://app.tested.dev/repos/{owner}/{name}` shows the PR gate, default-branch coverage, and the Tests and Performance tabs from JUnit.

1. Install the GitHub App and open the repo once on https://app.tested.dev/repos.
2. Mint a token at `https://app.tested.dev/repos/{owner}/{name}/settings`. `tested token` prints the URL for your `origin`.
3. Set `TESTED_TOKEN` (or `TESTED_TOKEN_FILE` with mode `0600`, or `TESTED_INGEST_TOKEN`).

```
$ tested push --pr 42
✓ shared  https://app.tested.dev/share/…
  expires 2026-…
```

On the default branch, `tested push --mainline` records project coverage with no PR and no share URL. The Action does this when `push: true` runs on a `push` event to the default branch.

| Flag / env | |
|---|---|
| `--pr` / `GITHUB_PR_NUMBER` / `PR_NUMBER` | PR number. Required unless `--mainline` |
| `--mainline` | Default-branch project coverage |
| `--base` | Git base for the diff (same as `tested diff --base`) |
| `--junit` / `TESTED_JUNIT` | JUnit XML. Auto-detected when omitted |
| `--file` | Coverage file to merge (repeatable) |
| `--flag` | This coverage file is one flag |
| `--parts N --part i`, `--complete`, `--incomplete` | Matrix shard handshake. An upload with `complete: false` does not conclude the PR check |
| `--run-id` / `--shard` | Group shards for one CI run and SHA |
| `--owner` / `--name` | Repo identity. Default: `GITHUB_REPOSITORY`, else the `origin` remote |
| `--url` / `TESTED_API_URL` | API base. Default `https://app.tested.dev` |
| `--token` | Works, but shows up in `ps`. Prefer the env vars |
| `--json` | `{ "shareUrl", "expiresAt" }` |

## Agents

The loop an agent runs, all with `--json`:

```bash
tested run --json       # { command, exitCode, coverageWritten, coveragePath }
tested diff --json      # files[].uncoveredRanges says where tests are missing
tested check --json     # overall: "pass" | "fail"
tested explain src/foo.ts:42 --json
```

`tested diff --json` is schema v1: `base`, `head`, `patch`, `project`, `files[]` (each with `patchCoverage`, `projectCoverage`, `uncoveredRanges`), and `ignored[]`. Human output is monochrome with status colors only and honors `NO_COLOR`.

## Security

`tested run` executes your project's test runner (`npx vitest`, `jest`, `pytest`). Only run it in repositories you trust.

- Token: `TESTED_TOKEN`, `TESTED_INGEST_TOKEN`, or `TESTED_TOKEN_FILE` (rejected when world-readable). `--token` is visible in `ps`.
- In CI, non-interactive shells, or with `TESTED_SAFE_RUN=1`, `tested run` rejects `--watch` / `--watchAll` and `--config` paths outside the repo root.
- Push sends the token only to `https://app.tested.dev` or `*.tested.dev` (plus `http://localhost`). Other hosts need `TESTED_ALLOW_CUSTOM_API_URL=1`. Redirects are refused.
- Always-on MCP hosts: set `TESTED_ALLOWED_CWDS` (see `@tested/mcp`) so tools cannot target arbitrary directories.

## Development

```bash
pnpm install
pnpm test
pnpm build      # dist/tested.js
```

The husky pre-push hook runs `tested` on this repo and blocks the push when patch coverage is under 50%.

## Release

`.github/workflows/release.yml` publishes to npm from a GitHub Release with [trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). No npm token.

1. Bump `version` in `package.json` on `main` and merge.
2. From that commit: `gh release create vX.Y.Z --generate-notes`. The tag must match `package.json` (`v0.1.10` → `0.1.10`).

One-time setup on npmjs.com (package settings → Trusted Publisher → GitHub Actions):

- Organization: `tested-hq`
- Repository: `cli`
- Workflow filename: `release.yml`
- Environment: none
- Allowed action: `npm publish`
