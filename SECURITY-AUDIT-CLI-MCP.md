# Security Audit — `@tested/cli` + `@tested/mcp`

| Field | Value |
|-------|--------|
| **Date** | 2026-07-21 |
| **Scope** | Market-release readiness for `@tested/cli` and `@tested/mcp` |
| **Repos** | `cli/` (`@tested/cli`), sibling `mcp/` (`@tested/mcp`) |
| **Branch** | `sec/audit-cli-mcp` |
| **Auditor** | Senior security review (automated + manual code inspection) |

## Executive summary

Both packages are small, mostly well-structured coverage tools. The CLI already had solid path-boundary checks (`assertWithinRoot`) for coverage and source reads. The MCP layer had useful `validateCwd` controls, but **`write_and_verify` skipped them before writing and spawning**, and **`tested push` would send the ingest Bearer token to any attacker-controlled `--url` / `TESTED_API_URL`**, including over cleartext HTTP, while following redirects by default.

**Critical/High issues were fixed in this branch** (see § Remediation status). Remaining items are Medium/Low and should be tracked before or shortly after market release.

### Severity counts (post-fix residual)

| Severity | Open | Fixed this branch |
|----------|------|-------------------|
| Critical | 0 | 2 |
| High | 0 | 4 |
| Medium | 6 | 0 |
| Low / Informational | 5 | 0 |

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
| **Status** | Open |

**Description.**  
After absolute-path validation, any absolute JS file can be executed as the CLI. PATH resolution via `which tested` trusts the environment.

**Remediation.**  
Prefer `require.resolve('@tested/cli/...')` in production configs; document that `TESTED_BIN` must be admin-controlled; optionally require the basename to match `tested.js` and `fs.realpath` under a known prefix allowlist (`TESTED_BIN_ALLOW_PREFIX`).

---

### M2 — Untrusted repo roots execute local test code (by design)

| | |
|--|--|
| **Severity** | Medium |
| **Package** | Both (especially MCP) |
| **Status** | Open (accepted with mitigations) |

**Description.**  
`tested run` and MCP `write_and_verify` intentionally spawn `npx vitest` / jest / pytest in the target project. Opening an untrusted repository is equivalent to running its tests (and thus any code those tests load).

**Remediation.**  
- Document clearly: only point tools at trusted repos.  
- Strongly recommend setting `TESTED_ALLOWED_CWDS` for always-on MCP hosts.  
- Optional future: container/seatbelt sandbox, or `node --permission` / network-disabled vitest.

---

### M3 — Symlink path escape under an allowed cwd

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/mcp` |
| **Status** | Open |

**Description.**  
`assertWithinCwd` uses string-prefix checks on `path.resolve` results. `validateCwd` rejects a **symlink cwd**, but an intermediate directory under a real git root (e.g. `tests` → `/etc`) can still redirect `writeFile` outside the logical tree.

**Remediation.**  
After resolve, `realpath` the deepest existing ancestor and ensure it remains under `realpath(cwd)`; refuse writes through symlink components (`lstat` walk).

---

### M4 — `tested run` forwards arbitrary args to the runner

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/cli` |
| **Status** | Open (mostly intentional) |

**Description.**  
`allowUnknownOption(true)` + `[args...]` forwards user args to `npx vitest|jest` or `python -m pytest`. Spawn uses argv arrays (no shell), which avoids classic injection, but args can enable unexpected runner features (config override, watch mode hangs, custom reporters writing files).

**Remediation.**  
Document risk; optionally denylist dangerous flags (`--config` pointing outside repo, `--watch`) for non-interactive use; keep argv spawn (do not introduce `shell: true`).

---

### M5 — Token visible on process argv via `--token`

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/cli` |
| **Status** | Open |

**Description.**  
`tested push --token <secret>` exposes the secret to local process listings (`ps`), audit agents, and crash dumps. Env vars are slightly better but still readable by same-uid processes.

**Remediation.**  
Document prefer `TESTED_TOKEN` / `TESTED_INGEST_TOKEN`; warn when `--token` is used on a TTY; support reading token from a file descriptor or `TESTED_TOKEN_FILE` with `0600` checks.

---

### M6 — Soft payload caps only warn (MCP read tools)

| | |
|--|--|
| **Severity** | Medium |
| **Package** | `@tested/mcp` |
| **Status** | Open |

**Description.**  
`get_uncovered_diff` / `get_coverage_summary` log when JSON exceeds 32 KiB but still return full payloads. Huge diffs can bloat model context or MCP host memory (partially mitigated by CLI stdout cap).

**Remediation.**  
Hard-truncate or paginate `files[]`; return a `truncated: true` flag.

---

### L1 — Coverage JSON path confusion / outside-repo paths in output

| | |
|--|--|
| **Severity** | Low |
| **Package** | `@tested/cli` |
| **Status** | Open |

**Description.**  
`parseIstanbul` trusts `entry.path` from coverage-final.json for relative path display. A malicious coverage file can inject odd relative paths (`../…`) into JSON output. File *reads* for explain are gated by `assertWithinRoot`.

**Remediation.**  
Skip or reject coverage entries whose resolved path escapes `repoRoot`.

---

### L2 — Git refs passed to `rev-parse` / `diff` without shape validation

| | |
|--|--|
| **Severity** | Low |
| **Package** | Both |
| **Status** | Open |

**Description.**  
`base` from config/flags/MCP is passed via argv arrays to git (no shell injection). Exotic refs can still cause unexpected git behavior or slow operations.

**Remediation.**  
Constrain `base` to a safe charset (`[A-Za-z0-9_./@~^-]{1,256}`) and reject leading `-`.

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
| Token handling | Env preferred; `--token` still argv-visible (M5) |
| Git command injection | Low risk: simple-git argv arrays, no `shell: true` |
| Path traversal (cwd/coverage) | CLI solid; MCP write fixed C2; symlink residual M3 |
| Arbitrary file write | MCP write gated by cwd validation + relative path check |
| Supply chain of test runners | Inherent (M2/M4); document + allowlist |
| SSRF via `--url` | Fixed C1 |
| Secret leakage in logs/JSON | Fixed H1; residual M5/L3 |
| MCP tool args (cwd, paths) | validateCwd + assertWithinCwd |
| Command injection via `TESTED_BIN` | Absolute path required (H4); integrity open (M1) |
| Sandbox escape | Allowlist optional; default any git repo (M2) |
| DoS via `write_and_verify` | Fixed H2 |

---

## Remediation status (this branch)

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
| `assertSafeTestedBin` | `src/cli.ts` |
| Tests | `tests/tools/write_and_verify.test.ts`, `tests/cli-bin-resolution.test.ts` |

### Verification

```text
cli:  pnpm test  → 135 passed
mcp:  pnpm test  → 42 passed (5 skipped env-dependent)
```

---

## Recommended release gate

Before marketing “secure by default” for always-on agent hosts:

1. **Ship** this branch’s Critical/High fixes.  
2. **Document** in both READMEs:  
   - Prefer `TESTED_TOKEN` over `--token`.  
   - Set `TESTED_ALLOWED_CWDS` for MCP.  
   - Only trusted repositories.  
3. **Track** M1 (bin integrity), M3 (symlink write), M5 (token file), M6 (hard payload caps).  
4. Add CI job: `pnpm audit --prod` + license check.  
5. Consider defaulting MCP to **deny** when `TESTED_ALLOWED_CWDS` is unset in non-TTY / service installs (breaking change — gate behind env `TESTED_REQUIRE_ALLOWLIST=1`).

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
| Path within root | `assertWithinRoot` | `assertWithinCwd` + `validateCwd` |
| Cwd is git repo | implicit via `openRepo` | explicit `.git` check |
| Symlink cwd rejected | no | yes |
| Allowlist | n/a | `TESTED_ALLOWED_CWDS` |
| HTTPS API only | yes (post-fix) | n/a |
| Redirects disabled on auth POST | yes | n/a |
| Subprocess shell | no | no |
| Output / time limits | no (run inherits) | yes (post-fix) |
