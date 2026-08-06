# Handoff — Claude Code adapter, Plan 1 of 3 (2026-08-06)

**Branch:** `worktree-compressed-skipping-dongarra`
**Range:** `2a25772..06a3d63` (24 commits)
**Status:** complete, whole-branch reviewed, verdict MERGE

Plan: `docs/superpowers/plans/2026-08-06-claude-code-adapter-negotiation.md`
Ledger item: `wb_01KZ77NSW8ZP1289HFMN2ECNXD`

---

## What shipped

A shared adapter engine in `src/adapter/` — `manifest.js`, `entrypoint-path.js`,
`describe.js`, `core-probe.js`, `schema-helpers.js`, `bootstrap.js` — plus a
runnable package at `adapters/claude-code/` (a static manifest and a Node
entrypoint speaking the §3.3 JSON-over-stdio wire), plus a conformance runner at
`spec/run-adapter-implementation.js`.

The engine is a deliberate **re-implementation** of `spec/adapter-reference.js`,
never an import of it. That independence is what makes the differential tests
mean anything; a whole-branch review confirmed it holds, with one honest caveat
recorded below.

**Tests: 519 passing on Node 26 and Node 20** (304 at branch start).

**Conformance: 79 of 183 assertions evidenced, run status `fail`.** That is the
correct result. `platform-declaration` is the only passing case. Plans 2 and 3
evidence the rest. A green run today would be a false claim.

`docs/adapter-contract.md` §10's status table is untouched — every Claude Code
row still reads `Unverified`, because native conformance evidence does not exist.

---

## Verify it yourself

```sh
TMPDIR=/tmp node --test test/*.test.js                              # 519 pass
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js # 519 pass
node spec/run-adapter-vectors.js                                    # reference-pass
node spec/run-adapter-implementation.js                             # fail, 79/183
printf '{"bootstrap_wire_version":1,"supported_adapter_contract_versions":[1],"request_id":"x"}' \
  | node adapters/claude-code/entrypoint.js describe                # ok:true, exit 0
```

The short `TMPDIR` is required — macOS caps `sockaddr_un.sun_path` at 104 bytes.

---

## Carry into Plan 2 — read before writing code

1. **The `request_id` strictness divergence is CORRECT. Do not reconcile it
   backwards.** The engine refuses a non-string `request_id`; the oracle's
   `SAFE_ID.test(...)` string-coerces and accepts one. §3.3 requires the safe
   opaque-ID syntax, which a non-string cannot satisfy, so the oracle is the
   lenient one. Roughly ten engine-vs-oracle divergences all sit here. A future
   task "fixing" them would be a regression.

2. **Extract `spec/scenario-shaping.js` before adding assertions.** The runner
   imports `mutateObject` and `applyCapabilityInvariantScenario` from
   `spec/run-adapter-vectors.js`, which imports 16 symbols from the oracle at
   module scope. No oracle value reaches a verdict — every verdict site was
   traced — but the oracle's `describeAdapter` / `verifyCoreProbe` /
   `resolveEntrypointPath` now sit in that module scope under names identical to
   the engine's. It is a footgun for a future editor, and it is a ten-minute job
   while it is still two pure functions.

3. **Settle the `assertion_evidence` shape in the contract, not the runner.**
   An agreeing and a disagreeing assertion are currently byte-identical in the
   report; only the case status flips. Adding `ok` would fix that, but §10
   requires the implementation runner to emit "the same result shape" as the
   reference runner, whose entries are exactly `{id, evidence}` (verified against
   the running reference across all 183). This is a contract amendment, not an
   implementation choice.

4. **`invoke` is declared but always refuses.** `entrypoints.invoke` is mandatory
   — §3.1 requires exactly `{describe, invoke}` and the manifest fails validation
   without it — so declaring it while returning `invalid-invocation` is the only
   conformant state until `src/adapter/invoke.js` lands. Two cases unblock the
   moment it does: `capability-separation` (its `refuse-before-core-launch`
   expectation needs `invokeAdapter`) and `negotiation-mismatch` (its sole
   outstanding `future-invoke-version-is-refused`).

5. **Enforce `max_request_bytes` before parsing.** The entrypoint currently reads
   stdin unbounded — conformant, since §3.3 assigns stream limits to the runner,
   but consequential once `invoke` carries real payloads.

6. **Evidence labels name the module, not the boundary.** Accurate today. Becomes
   ambiguous the moment wire-crossing assertions land.

---

## Known-and-accepted

- **`isCommandArray` holds two mutually redundant checks** — strict ordering and
  a uniqueness `Set`. Neither is independently killable; a behaviour test pins
  the refusal instead. Relaxing `>=` to `>` would make the uniqueness check
  silently load-bearing. Do not delete either without reading that test.
- **Sparse-array asymmetry** between `sameCommandOrder` (`Array.every` skips
  holes) and the oracle's `sameJson` (serialises holes as `null`) — 12
  divergences, unreachable over the wire because `JSON.parse` cannot produce a
  sparse array. One-line fix available (index loop) if Plan 2 ever hands the
  engine a synthesised array.
- **Array-order significance in `sameJson` is unobservable end-to-end** today —
  both arrays it compares hold one element. The property is pinned at the
  exported seam and holds the moment either list grows.
- **`src/cli.js` behaviour changed narrowly**, outside the adapter surface: a
  claim request carrying an own `__proto__` member is now refused rather than
  silently erased. This is a behaviour change, not pure refactoring. No stored
  data is affected — the old code erased such a member before it could be
  persisted.
- **One authorship caveat, recorded rather than smoothed over.**
  `describeAdapter`'s top-level negotiation sequence reproduces the oracle's
  refusal-detail object shapes verbatim (`{received}`, `{client, adapter}`,
  `{expected, describe}`, `{manifest, describe}`). Those key names appear nowhere
  in the contract. §3.3 fixes the check *order* normatively, so ordering
  convergence proves nothing, but four matching unspecified detail shapes is not
  coincidence. It does not make the differential tests tautological — they assert
  on `ok` and `error_code`, never on `detail` — but it is the one place the
  authorship is not independent.

---

## Process notes worth keeping

- **Check review packages for binary files before dispatching a review.**
  `git diff --stat BASE..HEAD | grep -i "Bin "`. Two source files were committed
  containing raw control bytes typed into regex character classes; git treated
  them as binary, so their content did not appear in the review diff at all. One
  task was reviewed and approved on a diff that contained none of its
  implementation.
- **Implementer mutation tables are condition-level; reviewers must check
  sub-expression level.** One task scored 55/56 conditions red and 4/10
  sub-expressions on the same code. Both numbers were honest.
- **Fixtures beat prose.** Five plan defects were caught this run, every one
  because the plan asserted a number or a shape without checking the fixture
  data. The standing rule — when the brief and the fixtures disagree, the
  fixtures win — earned its place.
- **The seam is where the real bugs were.** Both genuine defects (the
  `JsonNumber` boxing that meant no describe request could ever succeed, and the
  `__proto__` schema bypass) lived between two individually-correct tasks. Nine
  task-scoped reviews could not see either. Running the thing end to end did.
