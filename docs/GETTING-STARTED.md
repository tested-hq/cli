# Getting started — simple path

One loop. Same signal for humans, agents, and CI.

```
tested init
tested run
tested diff
tested check          # optional gate
tested push --pr <n>  # share on app.tested.dev
```

## 1. Install

```bash
# from this monorepo / package
pnpm install && pnpm build
# binary: dist/tested.js  (or link: pnpm link --global)
```

Node ≥ 22.

## 2. Init a repo

```bash
cd your-project
tested init --force
# writes .tested.yaml  (vitest/jest/pytest, thresholds, ignores)
```

## 3. Local coverage

```bash
tested run              # runs testRunner with coverage → coverage/coverage-final.json
tested diff             # human report (bars, gate, uncovered ranges)
tested diff --json      # schema-v1 for agents / CI
tested check            # exit 1 if below thresholds
```

**Empty patch** (no new executable lines): patch gate is **skipped**; project still applies.

## 4. Push to tested.dev (share URL)

Prereqs on **app.tested.dev**:

1. Install the GitHub App on the org/repo  
2. Open the repo once so it exists in the app  
3. **Settings → Ingest token** → copy token  

```bash
export TESTED_TOKEN=…           # or TESTED_INGEST_TOKEN
export GITHUB_PR_NUMBER=42      # or --pr 42

tested push
# → https://app.tested.dev/share/…
```

Useful flags:

| Flag | Default |
|------|---------|
| `--token` | `TESTED_TOKEN` / `TESTED_INGEST_TOKEN` |
| `--url` | `https://app.tested.dev` (`TESTED_API_URL`) |
| `--owner` / `--name` | from `git remote origin` |
| `--pr` | `GITHUB_PR_NUMBER` / `PR_NUMBER` |
| `--json` | print `{ shareUrl, expiresAt }` on stdout |

Errors are guided (missing token, repo not found, bad token).

## 5. CI (minimal)

```yaml
- run: pnpm test -- --coverage   # or: tested run
- run: tested check
- run: tested push --pr ${{ github.event.pull_request.number }}
  env:
    TESTED_TOKEN: ${{ secrets.TESTED_TOKEN }}
```

## 6. Agents (MCP)

```json
{
  "mcpServers": {
    "tested": {
      "command": "node",
      "args": ["/path/to/mcp/dist/tested-mcp.js"],
      "env": { "TESTED_BIN": "/path/to/cli/dist/tested.js" }
    }
  }
}
```

Tools: `get_coverage_summary`, `get_uncovered_diff`, `explain_line`, `write_and_verify`  
All need `cwd` + existing `coverage/coverage-final.json` (run `tested run` first).

## What you get

| Surface | Output |
|---------|--------|
| CLI human | monochrome report + gate |
| CLI `--json` | DiffOutput schema-v1 |
| `tested push` | public share page (gate + files + ranges) |
| MCP | same coverage math for agents |
| App dashboard | signed-in PR view (GitHub App) |

## DX principles

- **One loop** — run → diff → check → push  
- **Minimal chrome** — status color only; `NO_COLOR` respected  
- **Errors teach** — next command, not a stack dump  
- **Agents first** — stable JSON; exit codes mean gate  
