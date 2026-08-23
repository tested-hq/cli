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
    version: 0.1.5
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

`--json` on every command keeps agent schemas stable.

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

### GitHub Actions

```yaml
- uses: tested-hq/cli/action@main
  with:
    version: 0.1.5
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
| `--run-url` | Optional CI run URL |
| `--json` | Machine output: `{ "shareUrl", "expiresAt?" }` |

### `tested run` extra args

Extra args are forwarded to the runner via argv (no shell). In CI /
non-interactive mode / when `TESTED_SAFE_RUN=1`:

- `--watch`, `--watchAll`, `-w` are **rejected** (hang risk)
- `--config` / `-c` paths that resolve **outside the repo root** are **rejected**

Typical CI step after `tested check`:

```yaml
- run: pnpm exec tested push --pr "${{ github.event.pull_request.number }}" --base "${{ github.event.pull_request.base.sha }}"
  env:
    TESTED_TOKEN: ${{ secrets.TESTED_TOKEN }}
```
