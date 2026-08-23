# Getting started — simple path

One loop. Same signal for humans, agents, and CI.

```
tested setup          # init + doctor + CI snippet + token help
tested run
tested diff
tested check          # optional gate
tested push --pr <n>  # share on app.tested.dev
```

Or step by step: `tested init` → `tested doctor` → run / diff / check / push.

## 1. Install

```bash
pnpm add -D @tested/cli
# or
npx @tested/cli          # runs `tested` (`td` is the same CLI after install)
```

CLI and GitHub Action require Node 24+.

From this repo checkout:

```bash
pnpm install && pnpm build
# binary: dist/tested.js  (or: pnpm link --global)
```

CI uses the [GitHub Action](../action/README.md) (`tested-hq/cli/action@main`).

## 2. Setup (recommended first command)

```bash
cd your-project
tested setup
# writes .tested.yaml if missing
# runs doctor (node, git, config, coverage, origin, token, API URL, TESTED_BIN)
# prints CI snippet + token instructions
```

Flags: `--force` re-inits config; `--hooks` installs husky pre-push; `--json` for agents.

### Doctor only

```bash
tested doctor
tested doctor --json
```

Checks (badges `[PASS]` / `[FAIL]` / `[WARN]` / `[INFO]`):

| Check | Required | Notes |
|-------|----------|--------|
| Node.js | yes | Node >= 24. Fail below 24. |
| Git repository | yes | |
| `.tested.yaml` | yes | `tested setup` / `tested init` |
| Coverage file | warn | default `coverage/coverage-final.json` — run `tested run` |
| `origin` remote | yes | needed for push owner/name |
| Ingest token | warn | Mint at `https://app.tested.dev/repos/{owner}/{name}/settings`. Then `TESTED_TOKEN` / `TESTED_TOKEN_FILE` / `TESTED_INGEST_TOKEN` — **never printed** |
| `TESTED_API_URL` | if set | must be `https://` (or http localhost) |
| `TESTED_BIN` basename | if set | must match `/^tested(\.js)?$/` |

Exit **0** when required checks pass; **1** on hard failures (or unsafe API URL / bad `TESTED_BIN`).

## 3. Init only (if you skip setup)

```bash
tested init --force
# writes .tested.yaml  (vitest/jest/pytest, thresholds, ignores)
```

## 4. Local coverage

```bash
tested run              # coverage even if tests fail (Vitest --coverage.reportOnFailure)
tested diff             # human report (exit 0; not the gate)
tested diff --json      # schema-v1 for agents / CI
tested check            # exit 1 if below thresholds
```

Do not chain `tested run && tested diff`: a failing suite still writes coverage,
but `&&` skips diff. Run them as separate commands.

If you call Vitest yourself (`pnpm test:coverage`), set
`coverage.reportOnFailure: true` or pass `--coverage.reportOnFailure` so a
failed file still leaves `coverage/coverage-final.json`.

**Empty patch** (tests-only, comments-only, docs-only, or ignored files — no executable lines in scope): patch gate is **skipped**, not reported as 0% coverage. Project still applies. Human and `--json` both say `no executable lines in the patch`.

## 5. Push to tested.dev (share URL)

Prereqs on **app.tested.dev**:

1. Install the GitHub App on the org/repo  
2. Open the repo once so it exists in the app  
3. Mint a token at `https://app.tested.dev/repos/{owner}/{name}/settings`  

```bash
export TESTED_TOKEN=…           # preferred (or TESTED_TOKEN_FILE / TESTED_INGEST_TOKEN)
# or: export TESTED_TOKEN_FILE=$HOME/.config/tested/token  # chmod 600
export GITHUB_PR_NUMBER=42      # or --pr 42

tested push
# → https://app.tested.dev/share/…
```

Prefer env / token file over `--token` so the secret does not appear on process argv.

Useful flags:

| Flag | Default |
|------|---------|
| `--token` | prefer `TESTED_TOKEN` / `TESTED_INGEST_TOKEN` / `TESTED_TOKEN_FILE` |
| `--url` | `https://app.tested.dev` (`TESTED_API_URL`) |
| `--owner` / `--name` | from `git remote origin` |
| `--pr` | `GITHUB_PR_NUMBER` / `PR_NUMBER` |
| `--json` | print `{ shareUrl, expiresAt }` on stdout |

Errors are guided (missing token, repo not found, bad token).

## 6. CI — composite Action

Use the composite action under [`action/`](../action/) (see [action/README.md](../action/README.md)).

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
          version: 0.1.3
          push: true
          pr-number: ${{ github.event.pull_request.number }}
          token: ${{ secrets.TESTED_TOKEN }}
```

What the action does:

1. `actions/setup-node` **24**
2. `npm i -g @tested/cli@<version>` (or build from `cli-path` / `cli-ref`)
3. `tested` on PATH
4. `tested check` (Action defaults `--base` to the PR base SHA / previous push commit)
5. Optional `tested push` when `push: true`

Manual minimal gate (if CLI already on PATH):

```yaml
- run: pnpm test -- --coverage
- run: tested check
- run: tested push --pr ${{ github.event.pull_request.number }}
  env:
    TESTED_TOKEN: ${{ secrets.TESTED_TOKEN }}
```

## 7. Agents (MCP)

```json
{
  "mcpServers": {
    "tested": {
      "command": "node",
      "args": ["/path/to/mcp/dist/tested-mcp.js"],
      "env": {
        "TESTED_BIN": "/path/to/cli/dist/tested.js",
        "TESTED_BIN_ALLOW_PREFIX": "/path/to/cli/dist",
        "TESTED_ALLOWED_CWDS": "/absolute/path/to/your-project"
      }
    }
  }
}
```

Tools: `get_coverage_summary`, `get_uncovered_diff`, `explain_line`, `write_and_verify`  
All need `cwd` + existing `coverage/coverage-final.json` (run `tested run` first).

**Security:** only trusted repo cwds. For always-on MCP hosts set
`TESTED_ALLOWED_CWDS`. Optional `TESTED_BIN_ALLOW_PREFIX` (colon-separated)
restricts which realpaths may be used as the CLI binary. `tested doctor` flags
a bad `TESTED_BIN` basename.

## 8. Safe `tested run` in CI

`tested run` forwards extra args to the runner. In CI / non-interactive mode /
with `TESTED_SAFE_RUN=1` it rejects `--watch` / `--watchAll` and `--config`
paths outside the repository root.

## What you get

| Surface | Output |
|---------|--------|
| CLI human | monochrome report + gate |
| CLI `--json` | DiffOutput schema-v1 |
| `tested doctor` / `setup` | environment checklist + first-run guidance |
| `tested push` | public share page (gate + files + ranges) |
| MCP | same coverage math for agents |
| App dashboard | signed-in PR view (GitHub App) |
| GitHub Action | `tested-hq/cli/action` composite |

## DX principles

- **One loop** — setup → run → diff → check → push  
- **Minimal chrome** — status color only; `NO_COLOR` respected  
- **Errors teach** — next command, not a stack dump  
- **Agents first** — stable JSON; exit codes mean gate  
- **Action for CI** — `tested-hq/cli/action@main`; pin `version` in production  
