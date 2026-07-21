# Security Audit — `@tested/cli` + `@tested/mcp`

| Field | Value |
|-------|--------|
| **Date** | 2026-07-21 |
| **Scope** | Market-release readiness for `@tested/cli` and `@tested/mcp` |
| **Repos** | `cli/` (`@tested/cli`), sibling `mcp/` (`@tested/mcp`) |
| **Branch** | `sec/fix-mediums` (prior: `sec/audit-cli-mcp`) |
| **Auditor** | Senior security review (automated + manual code inspection) |

## Executive summary

Both packages are small, mostly well-structured coverage tools. The CLI already had solid path-boundary checks (`assertWithinRoot`) for coverage and source reads. Critical/High issues (SSRF/token exfil, write-before-validate, unbounded DoS, `TESTED_BIN` relative path) were fixed on `sec/audit-cli-mcp`.

**This branch (`sec/fix-mediums`) closes remaining Medium findings** (bin integrity, symlink write escape, run-arg denylist, token file / argv warn, hard payload caps) plus easy Lows (coverage path skip, git ref charset). M2 remains **Accepted** with prominent documentation and `TESTED_ALLOWED_CWDS` recommendation.

### Severity counts (post-fix residual)

| Severity | Open | Fixed | Accepted |
|----------|------|-------|----------|
| Critical | 0 | 2 | 0 |
| High | 0 | 4 | 0 |
| Medium | 0 | 5 | 1 (M2) |
| Low / Informational | 2 | 2 | 1 (L4) |

---

## Threat model (brief)

| Actor | Capabilities | Goals |
|-------|----------------|-------|
| Compromised CI / malicious workflow input | Flags, env, PR metadata, repo contents | Steal `TESTED_TOKEN`, pivot via SSRF, poison coverage |
| Malicious / untrusted repo root | Arbitrary files under a git repo the user points tools at | RCE via test runner, overwrite files, exfil via agent context |
| Prompt-injected MCP client (agent) | Tool args: `cwd`, `path`, `content`, `base`, `location` | Write outside intended project, DoS host, read secrets via runner output |
| Supply-chain adversary | Compromised `npx`/vitest/jest package or lockfile | Code execution when `tested run` / MCP re-runs tests |
| Local multi-tenant host | Shared MCP server process | Cross-repo access if allowlist not set |

**Out of scope for this pass:** backend `app.tested.dev` ingest API authz, npm publish provenance beyond lockfile pin review, OS-level sandboxing of the MCP host.

---

## Package map

### `@tested/cli`

| Surface | Location | Risk themes |
|---------|----------|-------------|
| `tested push` | `src/commands/push.ts` | Token handling, SSRF, secret leakage |
| Git ops | `src/git.ts`, `computeDiff` | Ref handling (array argv — no shell) |
| Coverage paths | `assert-within-root.ts`, `computeDiff`, `explain` | Path traversal |
| `tested run` | `src/commands/run.ts` | Spawn test runners / supply chain |
| Config | `.tested.yaml` via `loadConfig` | Coverage path escape (mitigated) |

### `@tested/mcp`

| Surface | Location | Risk themes |
|---------|----------|-------------|
| Tool args | `server.ts`, tool modules | Untrusted `cwd` / paths |
| CLI bridge | `cli.ts` | `TESTED_BIN`, spawn, timeouts |
| Cwd policy | `validate-cwd.ts` | Sandbox / allowlist |
| Write path | `write_and_verify.ts` | Arbitrary write, DoS |
| Runner | `run-tests.ts` | Unbounded process / output |

---

## Findings

Severity ratings use: **Critical** (immediate exploit, high impact) · **High** · **Medium** · **Low** · **Info**.

Status: **Fixed** (this branch) · **Open** · **Accepted risk**.

---

### C1 — SSRF / token exfiltration via `--url` / `TESTED_API_URL`

| | |
|--|--|
| **Severity** | Critical |
| **Package** | `@tested/cli` |
| **Status** | **Fixed** |
| **CWE** | CWE-918 (SSRF), CWE-522 |

**Description.**  
`resolveApiBase` previously accepted any string and posted `Authorization: Bearer <token>` to `{apiBase}/api/ingest`. An attacker who can set `--url` or `TESTED_API_URL` (e.g. malicious CI config, compromised env in a shared runner) could steal the ingest token by pointing at an attacker-controlled host. Cleartext `http://` was allowed for remote hosts.

**Fix.**  
- `assertSafeApiBase()` requires `https:` (or `http:` only for localhost / `127.0.0.1` / `::1` / `*.localhost`).  
- Rejects embedded URL credentials.  
- `postIngest` uses `redirect: 'manual'` and fails closed on 3xx so the Bearer token is not forwarded to a redirect target.

**Tests.** `tests/commands/push.test.ts` (safe URL, reject http remote, reject credentials, redirect refusal, executePush pre-network rejection).

---

### C2 — `write_and_verify` wrote and spawned before `validateCwd`

| | |
|--|--|
| **Severity** | Critical |
| **Package** | `@tested/mcp` |
| **Status** | **Fixed** |
| **CWE** | CWE-22, CWE-73 |

**Description.**  
Comments claimed `validateCwd` covered the write path, but it was only invoked inside `runCli` **after** the file write and **after** `npx vitest` spawn. A prompt-injected agent could pass a non-git, non-allowlisted absolute directory and still:

1. Overwrite/create a relative path under that directory.  
2. Execute the project’s test stack via `npx vitest` in that directory.

`TESTED_ALLOWED_CWDS` was therefore bypassable for the destructive half of the tool.

**Fix.**  
`writeAndVerify` now `await validateCwd(cwd)` as step 0, before size checks, write, or runner spawn.

**Tests.** `tests/tools/write_and_verify.test.ts` (“rejects cwd that is not a git repo before writing”).

---

### H1 — Git remote credentials leaked in error messages

| | |
|--|--|
| **Severity** | High |
| **Package** | `@tested/cli` |
| **Status** | **Fixed** |
| **CWE** | CWE-532 |

**Description.**  
When `parseGitHubRemote` failed, `executePush` embedded the raw `origin` URL in stderr:  
`could not parse owner/name from remote "${origin}"`.  
Remotes of the form `https://user:token@host/...` would print credentials into CI logs.

**Fix.**  
`redactGitRemote()` strips userinfo (`//***@…`) before error formatting.

---

### H2 — Unbounded `write_and_verify` content + runner output (DoS)

| | |
|--|--|
| **Severity** | High |
| **Package** | `@tested/mcp` |
| **Status** | **Fixed** |
| **CWE** | CWE-400 |

**Description.**  
`content` had no size limit. Test runner stdout/stderr were buffered without caps. Neither runner nor CLI subprocess had a timeout. A hostile agent or repo could fill disk/memory or hang the MCP server indefinitely.

**Fix.**  
- `MAX_WRITE_CONTENT_BYTES` = 1 MiB on write content.  
- Runner: `DEFAULT_TEST_TIMEOUT_MS` = 5 min, `MAX_CAPTURE_BYTES` = 2 MiB per stream, SIGTERM then SIGKILL.  
- CLI bridge: `DEFAULT_CLI_TIMEOUT_MS` = 2 min, `MAX_CLI_STDOUT_BYTES` = 8 MiB.

---

### H3 — Ingest fetch followed redirects with Bearer token

| | |
|--|--|
| **Severity** | High (merged operationally with C1) |
| **Package** | `@tested/cli` |
| **Status** | **Fixed** |

**Description.**  
Default `fetch` redirect following can re-send credentials depending on implementation and same-site vs cross-site behavior. Defense-in-depth requires never following redirects on authenticated ingest.

**Fix.**  
`redirect: 'manual'` + explicit error on 3xx.

---

### H4 — `TESTED_BIN` accepted relative / unsafe overrides

| | |
|--|--|
| **Severity** | High (context: host env integrity) |
| **Package** | `@tested/mcp` |
| **Status** | **Fixed** (partial; see M1) |
| **CWE** | CWE-426 |

**Description.**  
`TESTED_BIN` was taken verbatim and passed to `spawn('node', [TESTED_BIN, ...])`. A relative path would resolve against the tool’s `cwd` (attacker-influenced), enabling unexpected binary execution if env were set loosely.

**Fix.**  
`assertSafeTestedBin()` requires a non-empty absolute path without NUL bytes.

**Residual.** Existence / signature of the binary is not verified (see M1).

---

### M1 — No integrity check on resolved `TESTED_BIN` / PATH binary

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/mcp` |
| **Status** | **Fixed** |
| **CWE** | CWE-426 |

**Description.**  
After absolute-path validation, any absolute JS file can be executed as the CLI. PATH resolution via `which tested` trusts the environment.

**Fix.**  
- Basename should match `/^tested(\.js)?$/` when override is used: **hard-fail** if `TESTED_BIN_ALLOW_PREFIX` is set, **warn** otherwise.  
- Optional env `TESTED_BIN_ALLOW_PREFIX` (colon-separated): resolved realpath of `TESTED_BIN` must start with one of the prefixes.  
- Documented in MCP README + CLI GETTING-STARTED.

**Tests.** `tests/cli-bin-resolution.test.ts`.

---

### M2 — Untrusted repo roots execute local test code (by design)

| | |
|--|--|
| **Severity** | Medium |
| **Package** | Both (especially MCP) |
| **Status** | **Accepted** (documented + allowlist recommended) |

**Description.**  
`tested run` and MCP `write_and_verify` intentionally spawn `npx vitest` / jest / pytest in the target project. Opening an untrusted repository is equivalent to running its tests (and thus any code those tests load).

**Mitigations shipped.**  
- Prominent README security sections: only trusted cwds.  
- Strongly recommend `TESTED_ALLOWED_CWDS` for always-on MCP hosts.  
- Optional future: container/seatbelt sandbox, or `node --permission` / network-disabled vitest.

---

### M3 — Symlink path escape under an allowed cwd

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/mcp` |
| **Status** | **Fixed** |
| **CWE** | CWE-59 |

**Description.**  
`assertWithinCwd` used string-prefix checks on `path.resolve` results. `validateCwd` rejects a **symlink cwd**, but an intermediate directory under a real git root (e.g. `tests` → `/etc`) could still redirect `writeFile` outside the logical tree.

**Fix.**  
`assertSafeWritePath`: after resolve, `realpath` the deepest existing ancestor (must stay under `realpath(cwd)`); lstat-walk every path component and refuse symlinks whose realpath is outside the tree.

**Tests.** `tests/safe-path.test.ts`, `tests/tools/write_and_verify.test.ts`.

---

### M4 — `tested run` forwards arbitrary args to the runner

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/cli` |
| **Status** | **Fixed** (denylist in non-interactive/CI) |

**Description.**  
`allowUnknownOption(true)` + `[args...]` forwards user args to `npx vitest|jest` or `python -m pytest`. Spawn uses argv arrays (no shell), which avoids classic injection, but args can enable unexpected runner features (config override, watch mode hangs, custom reporters writing files).

**Fix.**  
When `TESTED_SAFE_RUN=1`, `CI` is set, or the process is non-interactive: reject `--watch` / `--watchAll` / `-w`, and reject `--config` / `-c` paths that escape the repo root. Documented in README / GETTING-STARTED. Spawn remains argv-only (no `shell: true`).

**Tests.** `tests/commands/run.test.ts`.

---

### M5 — Token visible on process argv via `--token`

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/cli` |
| **Status** | **Fixed** |

**Description.**  
`tested push --token <secret>` exposes the secret to local process listings (`ps`), audit agents, and crash dumps. Env vars are slightly better but still readable by same-uid processes.

**Fix.**  
- Prefer documenting env; support `TESTED_TOKEN_FILE` (read file; reject world-readable mode when POSIX bits available).  
- When `--token` is used on a TTY, stderr warns once.  
- Documented in README / GETTING-STARTED.

**Tests.** `tests/commands/push.test.ts` (`resolveToken`, `readTokenFile`).

---

### M6 — Soft payload caps only warn (MCP read tools)

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/mcp` |
| **Status** | **Fixed** |
| **CWE** | CWE-400 |

**Description.**  
`get_uncovered_diff` / `get_coverage_summary` logged when JSON exceeds 32 KiB but still returned full payloads. Huge diffs can bloat model context or MCP host memory.

**Fix.**  
`applyPayloadCap` hard-truncates `files[]` when over 200 files or ~64 KiB serialized JSON; sets `truncated: true`. Soft 32 KiB warning retained.

**Tests.** `tests/payload-cap.test.ts`.

---

### L1 — Coverage JSON path confusion / outside-repo paths in output

| | |
|--|--|
| **Severity** | Low |
| **Package** | `@tested/cli` |
| **Status** | **Fixed** |

**Description.**  
`parseIstanbul` trusted `entry.path` from coverage-final.json for relative path display. A malicious coverage file could inject odd relative paths (`../…`) into JSON output. File *reads* for explain are gated by `assertWithinRoot`.

**Fix.**  
Skip coverage entries whose resolved path escapes `repoRoot`.

**Tests.** `tests/core/istanbul.test.ts`.

---

### L2 — Git refs passed to `rev-parse` / `diff` without shape validation

| | |
|--|--|
| **Severity** | Low |
| **Package** | Both |
| **Status** | **Fixed** |

**Description.**  
`base` from config/flags/MCP is passed via argv arrays to git (no shell injection). Exotic refs can still cause unexpected git behavior or slow operations.

**Fix.**  
Constrain `base` to `[A-Za-z0-9_./@~^-]{1,256}` and reject leading `-` (`assertSafeGitRef` in CLI `computeDiff` + MCP tools/schemas).

**Tests.** `tests/git-ref.test.ts` (both packages).

---

### L3 — Vitest/test stdout may contain secrets returned to the agent

| | |
|--|--|
| **Severity** | Low |
| **Package** | `@tested/mcp` |
| **Status** | Open |

**Description.**  
On test failure, `vitestStderr` / `vitestStdout` are returned to the model. Tests that print env secrets leak into the agent transcript.

**Remediation.**  
Truncate more aggressively; optional redaction of `AKIA…`, `ghp_…`, `Bearer …` patterns; document “don’t log secrets in tests.”

---

### L4 — `init` installs a pre-push hook that runs `tested diff`

| | |
|--|--|
| **Severity** | Low |
| **Package** | `@tested/cli` |
| **Status** | Accepted |

**Description.**  
Hook install is gated (`--no-hooks`, husky presence, non-TTY requires `--force`). Low abuse potential; mainly developer UX.

---

### I1 — Dependencies pinned in lockfile

| | |
|--|--|
| **Severity** | Info |
| **Status** | Positive control |

Both packages use `pnpm-lock.yaml` with exact versions in `package.json` for direct deps (`simple-git`, `commander`, `@modelcontextprotocol/sdk`, `zod`, etc.). Continue Dependabot/Renovate + `pnpm audit` in CI.

---

### I2 — Path traversal defenses already present (CLI)

| | |
|--|--|
| **Severity** | Info |
| **Status** | Positive control |

`assertWithinRoot` correctly appends `sep` to avoid `/repo` vs `/repo-evil` prefix bugs and is used for coverage path and explain source reads. Unit tests cover sibling-prefix and `..` escapes.

---

### I3 — MCP error truncation

| | |
|--|--|
| **Severity** | Info |
| **Status** | Positive control |

`tool-error.ts` truncates error text to 500 chars, reducing accidental dump of large stderr into the model (though failure paths of write_and_verify still return capped vitest output in structured fields).

---

## Scope checklist

| Area | Result |
|------|--------|
| CLI push → remote API | Fixed C1/H3; token only via Bearer; no token in success JSON |
| Token handling | Env / `TESTED_TOKEN_FILE` preferred; `--token` warns on TTY (M5 fixed) |
| Git command injection | Low risk: simple-git argv arrays, no `shell: true`; ref charset (L2) |
| Path traversal (cwd/coverage) | CLI solid; MCP write fixed C2 + M3 symlink; L1 coverage skip |
| Arbitrary file write | MCP write gated by cwd validation + symlink-safe path |
| Supply chain of test runners | Inherent (M2 accepted); run denylist M4; allowlist recommended |
| SSRF via `--url` | Fixed C1 |
| Secret leakage in logs/JSON | Fixed H1/M5; residual L3 (test stdout) |
| MCP tool args (cwd, paths) | validateCwd + assertSafeWritePath |
| Command injection via `TESTED_BIN` | Absolute path (H4) + prefix/basename integrity (M1) |
| Sandbox escape | Allowlist optional; default any git repo (M2 accepted) |
| DoS via `write_and_verify` | Fixed H2 |
| MCP payload size | Hard caps + `truncated` (M6) |

---

## Remediation status

### Prior branch (`sec/audit-cli-mcp`) — Critical / High

### `@tested/cli`

| Change | File(s) |
|--------|---------|
| `assertSafeApiBase`, HTTPS/localhost policy | `src/commands/push.ts` |
| `redactGitRemote` on parse failures | `src/commands/push.ts` |
| `redirect: 'manual'` + 3xx failure | `src/commands/push.ts` |
| Unit tests for above | `tests/commands/push.test.ts` |

### `@tested/mcp`

| Change | File(s) |
|--------|---------|
| `validateCwd` before write/spawn | `src/tools/write_and_verify.ts` |
| 1 MiB content cap | `src/tools/write_and_verify.ts` |
| Runner timeout + output caps | `src/tools/run-tests.ts` |
| CLI timeout + stdout cap + NUL reject | `src/cli.ts` |
| `assertSafeTestedBin` (absolute path) | `src/cli.ts` |
| Tests | `tests/tools/write_and_verify.test.ts`, `tests/cli-bin-resolution.test.ts` |

### This branch (`sec/fix-mediums`) — Medium / easy Low

### `@tested/cli`

| Change | File(s) |
|--------|---------|
| M4 safe-run denylist (`--watch`, escaping `--config`) | `src/commands/run.ts` |
| M5 `TESTED_TOKEN_FILE` + TTY `--token` warn | `src/commands/push.ts` |
| L1 skip coverage entries outside repoRoot | `src/core/istanbul.ts` |
| L2 `assertSafeGitRef` on base | `src/git-ref.ts`, `src/core/computeDiff.ts` |
| Security docs | `README.md`, `docs/GETTING-STARTED.md` |

### `@tested/mcp`

| Change | File(s) |
|--------|---------|
| M1 `TESTED_BIN_ALLOW_PREFIX` + basename policy | `src/cli.ts` |
| M3 symlink-safe write path | `src/safe-path.ts`, `src/tools/write_and_verify.ts` |
| M6 hard payload caps + `truncated` | `src/payload-cap.ts`, tools |
| L2 git ref validation | `src/git-ref.ts`, schemas, tools |
| Security docs | `README.md` |

### Verification

```text
cli:  pnpm test
mcp:  pnpm test
```

---

## Recommended release gate

Before marketing “secure by default” for always-on agent hosts:

1. **Ship** Critical/High + Medium fixes (this branch).  
2. **Document** (done): prefer env token, `TESTED_ALLOWED_CWDS`, trusted repos only, `TESTED_BIN_ALLOW_PREFIX`.  
3. Add CI job: `pnpm audit --prod` + license check.  
4. Consider defaulting MCP to **deny** when `TESTED_ALLOWED_CWDS` is unset in non-TTY / service installs (breaking change — gate behind env `TESTED_REQUIRE_ALLOWLIST=1`).  
5. Residual accepted: M2 (untrusted repo RCE by design of test runners); L3 (test stdout secrets); optional future sandboxing.

---

## Appendix A — Sensitive data handling

| Data | Handling |
|------|----------|
| Ingest token | Header only; not written to disk by CLI; not included in share JSON |
| Git remotes | Redacted in push errors when userinfo present |
| Coverage JSON | Local file; may reflect private source structure when pushed to API |
| Share URL | Returned on stdout; treat as capability URL if backend does |

No secrets were embedded in this report or in test fixtures (tokens like `secret` / `secret-token` are mock values only).

---

## Appendix B — Quick reference: security controls matrix

| Control | CLI | MCP |
|---------|-----|-----|
| Path within root | `assertWithinRoot` | `assertSafeWritePath` + `validateCwd` |
| Cwd is git repo | implicit via `openRepo` | explicit `.git` check |
| Symlink cwd rejected | no | yes |
| Intermediate symlink write escape | n/a | realpath + lstat walk |
| Allowlist | n/a | `TESTED_ALLOWED_CWDS` |
| Bin integrity | n/a | `TESTED_BIN_ALLOW_PREFIX` + basename |
| HTTPS API only | yes | n/a |
| Redirects disabled on auth POST | yes | n/a |
| Safe run denylist | CI / non-TTY / `TESTED_SAFE_RUN` | n/a |
| Token file / argv warn | yes | n/a |
| Git ref charset | yes | yes |
| Subprocess shell | no | no |
| Output / time limits | no (run inherits) | yes + hard payload caps |
