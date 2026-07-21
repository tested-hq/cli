# @tested/cli

Coverage your agent can use. CLI for patch + project coverage with agent-readable JSON output.

## Dogfood

This repo enforces its own coverage gate on every push via husky pre-push hook:

```
🐕 dogfood: running tested on itself...
... coverage report ...
🐕 patch coverage 87.2% >= 50% — push allowed
```

The hook runs `tested run && tested diff` against the upstream branch (or `HEAD~1` if no upstream). Blocks push if patch coverage < 50%. Override with `git push --no-verify` (don't).

## Gating

`tested check` enforces the `thresholds` block in `.tested.yaml` and exits non-zero when patch or project coverage falls below the configured floor. Use it as a single-line CI gate.

```yaml
thresholds:
  patch: 80     # % of newly-added lines that must be covered
  project: 60   # % of the whole project that must be covered
```

```
$ tested check
✅ patch coverage 87.3% (threshold 80) — pass
✅ project coverage 64.1% (threshold 60) — pass
$ echo $?
0

$ tested check
❌ patch coverage 42.7% (threshold 80) — fail
✅ project coverage 64.1% (threshold 60) — pass
$ echo $?
1
```

If `thresholds` is missing from `.tested.yaml`, `tested check` prints a notice on stderr and exits 0 — configs that haven't opted in stay green.

### GitHub Actions

```yaml
- run: pnpm test -- --coverage
- run: pnpm exec tested check
```

The human-readable pass/fail lines go to **stderr**. A machine-friendly summary goes to **stdout**, so you can pipe `tested check | tee gate.txt` without losing the icons.

### `--json`

For programmatic consumers:

```
$ tested check --json
{"patch":{"pct":87.3,"threshold":80,"pass":true},"project":{"pct":64.1,"threshold":60,"pass":true},"overall":"pass"}
```

`--json` suppresses the human stderr lines; the exit code is unchanged.

## Share (`tested push`)

Push local patch/project coverage to [tested.dev](https://app.tested.dev) and get a share URL back. Closes the agent loop: local coverage → cloud link.

```
$ export TESTED_TOKEN=…          # or TESTED_INGEST_TOKEN / --token
$ export GITHUB_PR_NUMBER=42     # or --pr 42
$ tested push
https://app.tested.dev/s/…
```

| Flag / env | Purpose |
|---|---|
| `--token` / `TESTED_TOKEN` / `TESTED_INGEST_TOKEN` | Ingest auth (required) |
| `--pr` / `GITHUB_PR_NUMBER` / `PR_NUMBER` | PR number (required) |
| `--url` / `TESTED_API_URL` | API base (default `https://app.tested.dev`) |
| `--owner` / `--name` | Repo identity (default: parse `origin` remote) |
| `--pr-title`, `--author`, `--base-ref`, `--head-ref` | PR metadata overrides |
| `--base` | Git base for the coverage diff (same as `tested diff --base`) |
| `--run-url` | Optional CI run URL |
| `--json` | Machine output: `{ "shareUrl", "expiresAt?" }` |

Typical CI step after `tested check`:

```yaml
- run: pnpm exec tested push --pr "${{ github.event.pull_request.number }}"
  env:
    TESTED_TOKEN: ${{ secrets.TESTED_TOKEN }}
```
