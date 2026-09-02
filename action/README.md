# tested GitHub Action

Installs `@tested/cli` from npm, runs `tested check`, and optionally `tested push`.

## Usage

```yaml
# .github/workflows/tested.yml
name: tested
on: [pull_request]

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # produce coverage first (coverage/coverage-final.json by default)
      - run: pnpm install --frozen-lockfile
      - run: pnpm test -- --coverage

      - uses: tested-hq/cli/action@main
        with:
          version: 0.1.10
```

That is the gate. To also post the result to the PR and the project page on app.tested.dev:

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.10
    push: true
    pr-number: ${{ github.event.pull_request.number }}
    token: ${{ secrets.TESTED_TOKEN }}
```

In production, pin `uses:` to a commit SHA and keep `version: 0.1.10`.

What runs:

1. `actions/setup-node` with Node 24+.
2. `npm i -g @tested/cli@<version>`.
3. `tested check --base <sha>`. The base is the PR base SHA on `pull_request`, or the previous commit on `push`. It is fetched when missing, so a shallow checkout works.
4. `tested push` with the same base when `push: true`. This step is `continue-on-error`, so an upload problem cannot change the gate.

Coverage is the only PR gate. JUnit results feed the Tests and Performance tabs and never fail the PR.

## Before this step

1. Check out the repo. The default shallow clone from `actions/checkout@v4` is enough.
2. Produce coverage. Istanbul/V8 JSON at `coverage/coverage-final.json`, or the path in `.tested.yaml` (lcov, Cobertura, JaCoCo, gcov text, SimpleCov).
3. Optional: emit JUnit XML at `junit.xml`, `test-results/junit.xml`, `coverage/junit.xml`, or `reports/junit.xml`, or set `junit:`.
4. For `push: true`, store an ingest token as `secrets.TESTED_TOKEN`. Mint it at `https://app.tested.dev/repos/{owner}/{name}/settings`.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `version` | `0.1.10` | npm version of `@tested/cli` |
| `working-directory` | `.` | Directory with `.tested.yaml` and coverage |
| `base` | | Git base for check and push. Default: PR base SHA, or the previous commit on `push` |
| `push` | `false` | Run `tested push` after check |
| `pr-number` | | PR number for push. Default: the `pull_request` event |
| `mainline` | `false` | Push default-branch project coverage with no PR. Set automatically on a `push` event to the default branch |
| `token` | | Ingest token, passed as `TESTED_TOKEN` |
| `api-url` | | `TESTED_API_URL` override. Ambient `TESTED_API_URL` is ignored |
| `junit` | | JUnit XML path. Default: the first of `junit.xml`, `test-results/junit.xml`, `coverage/junit.xml`, `reports/junit.xml` |
| `files` | | Coverage files to merge before check and push (newline or comma separated). Overrides `coverage.path` |
| `flag` | | Flag name when this job is scoped to one package. The coverage file is that flag |
| `parts` | | Total shard count for a matrix |
| `part` | | 1-based shard index. When equal to `parts`, this upload concludes the gate |
| `complete` | | `true` concludes the gate, `false` uploads a shard only. Empty infers from `parts` and `part` |
| `run-id` | | Groups shards for one run and SHA. Default: `github.run_id` when `parts` is set |
| `shard` | | Shard label, for example the matrix job name |
| `node-version` | `24` | Node version for `actions/setup-node` |
| `cli-path` | | Local checkout of `tested-hq/cli` to build from instead of npm |
| `cli-ref` | | Git ref of `tested-hq/cli` to build from instead of npm |
| `cli-repository` | `tested-hq/cli` | Repository for `cli-ref` |

## Several coverage files in one job

Merge locally, then check and push once. Paths are unioned and hits are maxed per line.

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.10
    files: |
      coverage/lcov.info
      coverage/python.xml
    push: true
    token: ${{ secrets.TESTED_TOKEN }}
```

Or list the same paths under `coverage.path` in `.tested.yaml`.

## Matrix jobs

Collect each job's coverage as an artifact and run the Action once in a finish job. Shard 1 of N must never conclude the gate on its own.

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
          version: 0.1.10
          files: |
            coverage-node/lcov.info
            coverage-python/python.xml
          push: true
          token: ${{ secrets.TESTED_TOKEN }}
```

If a shard job has to push on its own, pass `parts` (and optionally `part` and `shard`). The upload is marked incomplete until the last part or a job with `complete: true`, so it cannot conclude the PR check, and `tested check` skips the local gate for it.

## Flags

`flags` in `.tested.yaml` add per-package floors to `tested check`. A flag with no coverage files this run is skipped.

A job that only builds one package tags its coverage file as that flag:

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.10
    flag: frontend
```

Other packages are left out of that upload, so their last result stands.

## Local checkout

For a monorepo that vendors the CLI, or to dogfood a branch:

```yaml
- uses: ./path/to/cli/action
  with:
    cli-path: ./path/to/cli
```

## Outside Actions

```bash
pnpm add -D @tested/cli
# or
npx @tested/cli
```

Node 24+. Manual equivalent of the Action:

```yaml
- run: tested check --base ${{ github.event.pull_request.base.sha }}
- run: tested push --pr ${{ github.event.pull_request.number }} --base ${{ github.event.pull_request.base.sha }}
  env:
    TESTED_TOKEN: ${{ secrets.TESTED_TOKEN }}
```

## Security

- Pass `token: ${{ secrets.TESTED_TOKEN }}` on this step only. Exporting `TESTED_TOKEN` at the job level exposes it to earlier untrusted steps such as `pnpm test`.
- `api-url`, `version`, `cli-path`, `cli-ref`, and `cli-repository` are trusted inputs. Do not feed them PR titles, branch names, or other untrusted values.
- Ambient `TESTED_API_URL` and `TESTED_ALLOW_CUSTOM_API_URL` are ignored, so a previous step writing `GITHUB_ENV` cannot redirect the token.
- Push uses `github.repository` for `--owner` and `--name`.
- The check step runs with `TESTED_SAFE_RUN=1`.
- The token value is never logged.
