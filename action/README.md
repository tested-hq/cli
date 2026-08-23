# tested GitHub Action

Composite action: install `@tested/cli` from **git** (or a local path), run
`tested check`, optionally `tested push`.

Local / agent installs use npm (`pnpm add -D @tested/cli`). CI uses this Action:
`uses: tested-hq/cli/action@main`. The Action clones
[`tested-hq/cli`](https://github.com/tested-hq/cli) and builds the CLI.

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
        with:
          fetch-depth: 0

      # your project: install deps + produce coverage/coverage-final.json
      - run: pnpm install --frozen-lockfile
      - run: pnpm test -- --coverage   # or: tested run once CLI is on PATH

      - uses: tested-hq/cli/action@main
        with:
          # pin a commit SHA in production
          cli-ref: main
```

## Gate + share URL

```yaml
- uses: tested-hq/cli/action@main
  with:
    cli-ref: main          # or full commit SHA
    push: true
    pr-number: ${{ github.event.pull_request.number }}
    token: ${{ secrets.TESTED_TOKEN }}
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `cli-path` | _(empty)_ | Local checkout of `tested-hq/cli` (skips git clone) |
| `cli-repository` | `tested-hq/cli` | GitHub `owner/name` to clone |
| `cli-ref` | `main` | Branch, tag, or **commit SHA** (prefer SHA in prod) |
| `working-directory` | `.` | Project root with `.tested.yaml` + coverage |
| `base` | _(empty)_ | Passed to `tested check --base` |
| `push` | `false` | Run `tested push` after check |
| `pr-number` | _(empty)_ | PR number for push (else `pull_request` event) |
| `token` | _(empty)_ | Ingest token → `TESTED_TOKEN` |
| `api-url` | _(empty)_ | Optional `TESTED_API_URL` |
| `node-version` | `24` | `actions/setup-node` version |

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

Node >= 20.19.

## Prerequisites in the consumer workflow

1. Checkout with enough history for your base ref (`fetch-depth: 0` is safest).
2. Produce Istanbul JSON at `coverage/coverage-final.json` (or the path in
   `.tested.yaml`) **before** this action runs — e.g. `pnpm test -- --coverage`
   or `tested run`.
3. For `push: true`, store an ingest token as `secrets.TESTED_TOKEN`
   (mint at `https://app.tested.dev/repos/{owner}/{name}/settings`).

## Security

- Prefer `token: ${{ secrets.TESTED_TOKEN }}` over putting secrets on argv.
- The action sets `TESTED_SAFE_RUN=1` for the check step context.
- Never log the token value.
