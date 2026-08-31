# tested GitHub Action

Install `@tested/cli` from npm, run `tested check`, optionally `tested push`.

`uses: tested-hq/cli/action@main`. Default install is `npm i -g @tested/cli@<version>`.

## Minimal (gate only)

```yaml
# .github/workflows/tested.yml
name: tested
on: [pull_request]

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # your project: install deps + produce coverage/coverage-final.json
      - run: pnpm install --frozen-lockfile
      - run: pnpm test -- --coverage

      - uses: tested-hq/cli/action@main
        with:
          version: 0.1.8
```

## Gate + share URL

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.8
    push: true
    pr-number: ${{ github.event.pull_request.number }}
    token: ${{ secrets.TESTED_TOKEN }}
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `version` | `0.1.8` | npm version of `@tested/cli` |
| `cli-path` | _(empty)_ | Local checkout of `tested-hq/cli` (skips npm) |
| `cli-repository` | `tested-hq/cli` | GitHub `owner/name` for the git fallback |
| `cli-ref` | _(empty)_ | Optional git ref instead of npm |
| `working-directory` | `.` | Project root with `.tested.yaml` + coverage |
| `base` | _(empty)_ | Override git base for check and push. Default: PR base SHA, or previous commit on push. Fetched if missing (no `fetch-depth: 0` required). |
| `push` | `false` | Run `tested push` after check |
| `pr-number` | _(empty)_ | PR number for push (else `pull_request` event) |
| `token` | _(empty)_ | Ingest token → `TESTED_TOKEN` |
| `api-url` | _(empty)_ | Optional `TESTED_API_URL` |
| `junit` | _(empty)_ | JUnit XML path. When empty, searches `junit.xml`, `test-results/junit.xml`, `coverage/junit.xml`, `reports/junit.xml` under the working directory. |
| `files` | _(empty)_ | Coverage files to **merge locally** (newline or comma-separated). Overrides `coverage.path`. One job, many artifacts. |
| `parts` | _(empty)_ | Total shard count for a matrix. Push is incomplete until `complete: true` or `part == parts`. Missing shards fail or stay pending — no carryforward. |
| `part` | _(empty)_ | 1-based shard index. When equal to `parts`, this upload concludes the gate. |
| `complete` | _(empty)_ | `true` concludes the gate (finish job / last part). `false` uploads a shard only — GitHub checks must not complete. Empty infers from `parts`/`part`. |
| `run-id` | _(empty)_ | Groups shards for one CI run + SHA. Defaults to `github.run_id` when `parts` is set. |
| `shard` | _(empty)_ | Optional shard label (e.g. matrix job name). |
| `flag` | _(empty)_ | Optional flag name when this job is already scoped to one package. The coverage file is that flag. Missing flags this run stay pending/fail — no carryforward. |
| `node-version` | `24` | `actions/setup-node` version |

## One job, many coverage files

Merge locally, then check and push **once**. Hits are maxed (not averaged); files are unioned. Last file does not win.

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.8
    files: |
      coverage/lcov.info
      coverage/python.xml
    push: true
    token: ${{ secrets.TESTED_TOKEN }}
```

Or list the same paths in `.tested.yaml`:

```yaml
coverage:
  path:
    - coverage/lcov.info
    - coverage/python.xml
```

## Matrix jobs (do not conclude on shard 1 of N)

A parallel matrix must **not** post a passing patch check on the first shard.
`tested check` skips the local gate when the upload is incomplete.
`tested push` sends `coverageMerge.complete: false` until `--complete` or the last part.

**Preferred (works today, no app change):** collect artifacts and merge in one finish job.

```yaml
jobs:
  test:
    strategy:
      matrix:
        lang: [node, python]
    steps:
      - uses: actions/checkout@v4
      - run: # produce coverage/lcov.info or coverage/python.xml
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ matrix.lang }}
          path: coverage/
  tested:
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
      - uses: tested-hq/cli/action@main
        with:
          version: 0.1.8
          files: |
            coverage-node/lcov.info
            coverage-python/python.xml
          push: true
          token: ${{ secrets.TESTED_TOKEN }}
```

**Shard uploads + finish handshake** (app must honor `coverageMerge` — see CLI PR):

```yaml
jobs:
  shard:
    strategy:
      matrix:
        node: [20, 22, 24]
    steps:
      - uses: actions/checkout@v4
      - run: # produce coverage
      - uses: tested-hq/cli/action@main
        with:
          version: 0.1.8
          push: true
          parts: 3
          shard: node-${{ matrix.node }}
          token: ${{ secrets.TESTED_TOKEN }}
  finish:
    needs: shard
    if: always()
    steps:
      - uses: actions/checkout@v4
      - uses: tested-hq/cli/action@main
        with:
          version: 0.1.8
          push: true
          complete: true
          token: ${{ secrets.TESTED_TOKEN }}
```

Until tested-hq/app stores shards and merges on `complete: true`, use the artifact + local-merge finish job. Shard jobs still must pass `parts` / `complete: false` so they do not conclude GitHub checks.

## Flags (per package)

`.tested.yaml` `flags` add per-package floors on `tested check` (global + each flag whose paths appear this run). No carryforward: a flag with no files this run is missing.

A frontend-only job can tag the coverage file as that flag:

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.8
    flag: frontend
```

App-posted GitHub checks (`tested.dev / patch / frontend`) are a follow-up on tested-hq/app. This Action runs the local gate and emits per-flag JSON from `tested check --json`.

## Local path (monorepo / dogfood)

```yaml
- uses: ./path/to/cli/action
  with:
    cli-path: ./path/to/cli
```

## Install CLI outside Actions

```bash
pnpm add -D @tested/cli
# or
npx @tested/cli
```

Node 24+.

## Prerequisites in the consumer workflow

1. Checkout the repo (`actions/checkout@v4` default shallow clone is enough —
   the Action fetches the PR base SHA / previous push commit when missing).
2. Produce coverage **before** this action runs — Istanbul/V8 JSON at
   `coverage/coverage-final.json` by default, or the path in `.tested.yaml`
   (lcov, Cobertura, JaCoCo, gcov text, SimpleCov). e.g. `pnpm test -- --coverage`
   or `tested run`. For flakes / suite time, also emit JUnit XML at
   `junit.xml`, `test-results/junit.xml`, or `coverage/junit.xml` (or set
   `junit:`).
3. For `push: true`, store an ingest token as `secrets.TESTED_TOKEN`
   (mint at `https://app.tested.dev/repos/{owner}/{name}/settings`).

## Security

- Prefer `token: ${{ secrets.TESTED_TOKEN }}` on this step only. Do not export
  `TESTED_TOKEN` at workflow/job level before untrusted steps (`pnpm test`):
  that code can read the secret or write `GITHUB_ENV`.
- `api-url`, `version`, `cli-path`, `cli-ref`, and `cli-repository` are trusted
  install/destination inputs. Do not pass PR titles, branch names, or other
  untrusted values into them.
- The action ignores ambient `TESTED_API_URL` / `TESTED_ALLOW_CUSTOM_API_URL`
  (a previous step writing `GITHUB_ENV` cannot redirect the Bearer token).
- Push uses `github.repository` for `--owner` / `--name`, not `git remote origin`.
- The action sets `TESTED_SAFE_RUN=1` for the check step context.
- Never log the token value.
