# Handoff — wowbagger, adapter implementation (2026-08-09)

**Worktree:** `/Users/leestutzman/Documents/GitHub/wowbagger`
**Branch:** `main`
**HEAD:** `ec5cb05` (`Apply item 24's review: one host-declaration factory, one wire scaffold`)
**Status:** clean checkout, all tests passing (561), adapter implementation complete, ready for conformance and platform validation

> **Next agent:** The adapter is built and tested. Verify conformance vectors pass when run against the real adapter binary (not the reference implementation), then validate across platforms (darwin/linux/win32) before PropertyCompass integration.

---

## Goal

Deliver a production-ready Claude Code adapter that translates harness requests into wowbagger core commands while maintaining strict interface validation and byte-for-byte output preservation.

## Shipped Progress (This Session)

| Task | Status | Details |
|---|---|---|
| Adapter manifest validation | ✅ Complete | Strict §3.1 schema, path safety, duplicate detection |
| Describe operation | ✅ Complete | Core capability probe, dynamic result §3.2 schema |
| Invoke operation | ✅ Complete | Request validation, core forwarding, byte preservation |
| Core subprocess wrapper | ✅ Complete | Spawning, I/O buffering, exit code fidelity |
| CLI entry point | ✅ Complete | Dispatch, stdin reading, error handling |
| Static manifest | ✅ Complete | `wowbagger-adapter.json` with strict validation |
| Test coverage | ✅ Complete | 561 total tests (219 adapter-specific) on Node 26 and Node 20 |

## Implementation Status

### Modules Built

| Module | Purpose | Lines | Tests |
|--------|---------|-------|-------|
| `src/adapter/manifest.js` | Static manifest validation with duplicate-member detection | 94 | Schema + entrypoint + platform validation |
| `src/adapter/describe.js` | Describe request parsing and dynamic result building | 237 | Request schema, core probe, result envelope |
| `src/adapter/invoke.js` | Invoke request validation and result building | 259 | Request schema, command validation, refusal handling |
| `src/adapter/bootstrap.js` | Wire version negotiation and capability selection | — | Shared bootstrap logic |
| `src/adapter/core-probe.js` | Core capability probe verification | — | Validates core matches contract |
| `src/adapter/entrypoint-main.js` | Main CLI entry point | — | Dispatch and handler orchestration |
| `src/adapter/entrypoint-path.js` | Entrypoint path resolution and safety | — | Safe path validation, no-follow |
| `src/adapter/schema-helpers.js` | Shared schema validation helpers | — | Reusable validators across modules |

### Test Coverage

- **561 total tests passing** on both Node 26 and Node 20
- **219 adapter-specific tests** covering:
  - Manifest validation (strict schema, path safety, duplicates)
  - Describe operation (request parsing, core probe, result building)
  - Invoke operation (request validation, forwarding, error handling)
  - Integration tests (end-to-end describe/invoke cycle)
  - Platform handling
  - Error conditions and refusals

### Test Command

```bash
# Node 26 (default)
TMPDIR=/tmp node --test test/*.test.js

# Node 20 (required verification)
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
```

## Acceptance Criteria Status

Per `ledger/2026-08-04-claude-code-adapter.md`:

1. **Manifest validation** ✅ — Strict §3.1 schema with path safety and platform enforcement
2. **Describe operation** ✅ — Valid §3.2 schema with core capability probe  
3. **Invoke forwarding** ✅ — Byte-for-byte output preservation, exit code fidelity
4. **Vector conformance** ⏸️ — Adapter implementation complete; runner integration pending
5. **No core mutation** ✅ — Pure boundary layer, no core behavior changes

## Open Work (Priority Order)

### 1. Conformance Vector Testing (High Priority)
**Status:** Adapter passes manual tests; reference runner needs update  
**What's needed:**
- Update `spec/run-adapter-vectors.js` to accept `--adapter <path>` flag
- Spawn real adapter binary instead of reference implementation
- Run all 15 `claude-code` vectors in `spec/fixtures/adapters/`
- Collect evidence: pass/fail per assertion

**Files to update:**
- `spec/run-adapter-vectors.js` — Add adapter spawning support
- `spec/adapter-reference.js` — May need adapter invocation wrapper

**Success criteria:** All 15 claude-code vectors pass

### 2. Platform Support Validation (High Priority)
**Status:** Adapter works on darwin; linux/win32 untested  
**What's needed:**
- Test adapter on linux (CI or manual VM)
- Test adapter on win32 (CI or manual VM)
- Update `wowbagger-adapter.json` platform status from `unverified` to `supported`

**Files to verify:**
- `wowbagger-adapter.json` — Platform status
- Test all 6 adapter operations on each platform

**Success criteria:** All 3 platforms marked `supported` with evidence

### 3. PropertyCompass Integration (Medium Priority)
**Status:** Adapter ready; PropertyCompass wiring TBD  
**What's needed:**
- Wire adapter into PropertyCompass wowbagger usage
- Test real backlog operations: `create`, `transition`, `inspect`
- Validate across concurrent worktrees

**Blockers:**
- None currently; ready for integration

### 4. Package Publication (Medium Priority)
**Status:** Manifest complete; distribution TBD  
**What's needed:**
- Publish as npm package or Claude Code plugin marketplace
- Ensure `wowbagger-adapter.json` discoverable at package root
- Document consumer installation and configuration

---

## Known Limitations

- **Vector runner not integrated** — Adapter passes all manual tests but conformance runner still uses reference implementation. Needs runner update to spawn adapter binary.
- **Platform status unverified** — All platforms marked `unverified` pending conformance evidence. Adapter works on darwin; linux/win32 need testing.
- **No concurrent invokes** — Current implementation sequential; concurrent safety not yet validated.
- **Handoff not yet integrated** — Adapter supports handoff_carrier structure but full handoff→resume loop not tested.

## Authoritative Facts

- **Canonical test command:** `TMPDIR=/tmp node --test test/*.test.js` (macro, long-running)
- **Node 20 location:** `/opt/homebrew/opt/node@20/bin/node` (Homebrew keg, not in PATH)
- **Current suite:** 561 tests, green on both runtimes
- **Never `git stash` in this repository** — Three worktrees share one stash stack
- **The adapter conforms to §3.1 and §3.2 of the adapter contract** — No custom extensions

## References

- **Adapter contract:** `docs/adapter-contract.md` (normative)
- **Conformance vectors:** `spec/fixtures/adapters/` (15 test cases)
- **Vector runner:** `spec/run-adapter-vectors.js` (reference implementation)
- **Adapter modules:** `src/adapter/` (7 modules + tests)
- **Ledger item:** `ledger/2026-08-04-claude-code-adapter.md` (tracking)
- **CLI:** `bin/wowbagger-adapter.js` → `src/adapter/entrypoint-main.js`
- **Manifest:** `wowbagger-adapter.json` (static, strictly validated)

## Prompt for Next Session

```
Context: continuing wowbagger from 2026-08-09. Adapter implementation complete;
561 tests passing on Node 26 and Node 20. Next phase: conformance validation
and platform support.

Read these first:
1. docs/handoffs/2026-08-09-adapter-completion.md (this file)
2. ledger/2026-08-04-claude-code-adapter.md (tracking + acceptance criteria)
3. docs/adapter-contract.md §3 (manifest and describe schemas)
4. spec/fixtures/adapters/README.md (conformance vector structure)

First actions:
1. Verify all 561 tests still pass on Node 26 and Node 20
2. Manually test adapter against 2-3 conformance vectors (e.g., 01-capability-separation)
3. Plan conformance runner update to spawn real adapter binary (not reference)
4. Identify platform testing path (linux/win32)

Tools:
- Adapter entry: node bin/wowbagger-adapter.js describe|invoke
- Manual describe: echo '{"bootstrap_wire_version": 1, "supported_adapter_contract_versions": [1], "request_id": "req_test"}' | node bin/wowbagger-adapter.js describe
- Manual invoke: echo '{"command": "capabilities", "request_id": "req_test"}' | node bin/wowbagger-adapter.js invoke
- Vector runner (reference): node spec/run-adapter-vectors.js

Success: All 15 claude-code vectors pass, all platforms marked supported.
```
