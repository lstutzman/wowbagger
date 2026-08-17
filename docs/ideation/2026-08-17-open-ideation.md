---
date: 2026-08-17
topic: open-ideation
focus: none (open-ended)
---

# Ideation: wowbagger, post-alpha.6

Method: six framed ideation scouts (48 raw ideas) → dedupe + synthesis (25 candidates) →
two adversarial skeptics → 5 survivors → deep enrichment of each survivor by GPT-5.6 Sol
at xhigh reasoning (full analyses in `enrichments/2026-08-17-*.md`; each is source-cited
and re-verified its own premises).

## Codebase Context

Contract v3 published as 0.1.0-alpha.6 on npm `next`. This week shipped: number identity,
layout binding (dogfooded), the widened patch surface (title/priority/relations/body/
body_append/extensions), claim-adopt, the response-domain envelope rule, the sequencing
dashboard with SVG evidence and the embedded 3D graph, invalid-ledger diagnosability, and
the epic derivation model. One live consumer (PropertyCompass2, 1,574 items, dual-run)
drives requirements through field reports. Measured remaining costs: publish-claimed's
per-item lock acquisitions and readGitHeadLedger's full-HEAD blob reads.

## Ranked Ideas

### 1. The provisioned-performance program (staged)
**Description:** Stage 0 (NEW, from enrichment): instrument the benchmark with phase
counters — the current bench cannot attribute lock-vs-HEAD-read dominance, so the causal
claim is unproven. Stage A/B in measured order: publish-claimed drops its per-item lock
closure and relies on the already-held namespace process lock (no timed lease — reuse
`withClaimLock`); the filename↔ID mapping becomes a two-tier contract (an `<id>.md`
basename claims that ID, mismatch is a new validation error, non-conforming names stay
legal via a specified full-scan fallback), narrowing HEAD reads to the requested ID set.
Stage 3: re-measure; a read cache exists only as a decision point.
**Rationale:** Attacks the only two measured costs; six ideation frames converged here.
**Downsides:** Core contract v4 (filename authority changes accepted-ledger semantics);
mixed-version writers can violate serialization without a quiesced upgrade or fence; the
fast path decays toward full reads as coordinated-item history grows (benchmark C=N).
**Enrichment finds:** publish lock metadata is already internally inconsistent
(`lockSource` writes `publish-claimed`; `validLockOwner` accepts only create/transition/
patch) — a live defect the change would erase. Migration plan for both this repo's 25
human-named files and the consumer's ledger included.
**Confidence:** 85% **Complexity:** High (staged L/L/M) **Status:** Unexplored

### 2. Auto-commit mode (`--auto-commit`)
**Description:** Opt-in bare flag on create/transition/patch/publish-claimed (provisioned
ledgers only) that stages exactly the item + its reconcile log and commits with a fixed
message, honoring hooks/signing/identity, refusing on any pre-existing ledger dirt.
Commit-failure is a named outcome (`git-commit-failed`, exit 6, state committed, carrying
the published revision + a bound recovery token); recovery is one idempotent
`mutation-finalize --recovery-token` invocation.
**Rationale:** The consumer's most frequent daily ceremony, folded away without weakening
the HEAD-surface durability model.
**Downsides:** L effort — the happy path is small; the honest failure contract, Git
process control (hooks can hang post-publication), and two response domains are the bulk.
**Enrichment finds:** a real contract gap — `publishClaimed` reconciles only when it sees
an unresolved intent, while the contract says ANY unreconciled prior mutation must refuse;
auto-commit's preflight closes it, but the gap deserves its own fix regardless.
**Confidence:** 80% **Complexity:** High **Status:** Unexplored

### 3. Release-channel repair
**Description:** Delete the `latest` dist-tag during pre-alpha (bare install fails loudly;
`@next` is explicit consent), deprecate alpha.1 with a pointer, and build
`scripts/cut-release.js`: preflight → in-memory plan over a checked-in version-site
manifest (`release-version-sites.json`, exact-set occurrence proof, fail-closed on
unmanifested sites) → gate → single cut commit → tag → verify. Dry-run mode proves
byte-identical repo state.
**Rationale:** `latest` currently serves dead alpha.1; version refs drifted once already
(196→200) with no guard.
**Downsides / enrichment finds:** the existing tags point at MERGE commits, not cut
commits — one-command cutting requires cutting on the final branch tip or staying
two-phase (maintainer decision); the CHANGELOG currently has NO `## Unreleased` section
(both prior cuts renamed it instead of recreating — a live bug this fixes); publish stays
manual (WebAuthn passkey).
**Confidence:** 90% **Complexity:** Medium **Status:** Unexplored

### 4. End-to-end core-outcome vectors (renamed from "adapter mutation vectors")
**Description:** One new equivalence case (~9 hand-authored scenarios: inspect
not-found, create/transition/patch successes incl. extensions, the date refusal, and all
three claim-fence refusal classes) that spawns the REAL adapter entrypoint over the
bootstrap wire against the REAL core with real approvals, dual isolated temp workspaces,
and fixed-input determinism (caller ULIDs, seeded clock floors — no output normalization).
Bright-line tautology rule: implementation code may execute vectors, never author their
expectations.
**Rationale / enrichment finds:** the gap is real but the history was corrected (the
inspect defect lived ~1 week, not months; the actually-shipped second defect was fence
dispatch). BLOCKING DISCOVERY: `runAdapterEntrypoint` plumbs NO approval/nonces/identity
into `invokeAdapter` — a mutation through the shipped entrypoint can only ever reach
`consumer-approval-required`. The vectors force that product gap open; fixing the
host-runtime plumbing is a prerequisite and arguably a defect fix on its own.
**Downsides:** ~27 extra core spawns in the conformance runner; approval-digest
path-binding makes determinism fiddly.
**Confidence:** 85% **Complexity:** Medium (3–5 days) **Status:** Unexplored

### 5. One item-source byte bound
**Description:** `MAX_ITEM_SOURCE_BYTES = 8 MiB` (the value publish-claimed already
enforces), measured over complete serialized item source, enforced at every candidate
door (create/transition/patch/publish-claimed) with one named refusal
(`item-source-too-large`, exact `{id,size_bytes,limit_bytes}` details), advertised in
capabilities limits. Stored oversized legacy items stay readable and shrinkable.
**Rationale / enrichment finds:** the skeptic's premise was WRONG in the right direction —
no named size error exists anywhere; an oversized publish candidate today gets a
MISLEADING "not canonical base64" message, and an empirical probe created a 50 MiB item
on alpha.6 (exit 0, 122 MB of JSON output). Consumer headroom measured: their largest
item is 0.96% of the bound.
**Downsides:** it is this project's FIRST contract narrowing against a published version —
requires core v4 (and work-claim api_version 2 if publish-claimed's pinned error text
changes); transition must also be bounded (decision growth) or the door stays open.
**Confidence:** 85% **Complexity:** Medium (3–5 days) **Status:** Unexplored

## Cross-cutting synthesis

Ideas 1 and 5 (and arguably 4's contract prose fixes) each independently require **core
contract v4**. Bundle the v4-carrying changes into one version bump and one release.

## Defects discovered during enrichment (independent of any idea)

| Defect | Source | Severity |
|---|---|---|
| Shipped adapter entrypoint plumbs no approval — mutations via entrypoint cannot succeed | enrichments/vectors §2 | High (verify + file) |
| publishClaimed skips reconciliation unless a pending intent exists, contra contract | enrichments/autocommit §3.8 | Medium |
| publish item-lock metadata fails validLockOwner shape (`publish-claimed` op name) | enrichments/perf §2.6 | Medium |
| Oversized publish candidate returns a false "not canonical base64" message | enrichments/bodybound §1 | Medium |
| CHANGELOG has no `## Unreleased` section (cut renamed it) | enrichments/release §3.4 | Low (trivial) |
| Adapter contract prose omits patch from command/approval tables | enrichments/vectors §4.7 | Low |

## Rejection Summary

| Idea | Reason rejected |
|---|---|
| MCP server / adapter session mode / swarm packets | No demand; spawn cost unmeasured; fence already provides the atomicity |
| Report weight (defer/sidecar) | Reverses a day-old explicit owner ruling with no new evidence |
| claim-doctor | Duplicates alpha.6's claim-adopt + remediation strings |
| Field-report intake verb | The manual loop drove 15 fixes in a week; a doc template is the 80% version |
| Capability manifest (standalone) | Fold into the next contract-version bump (now planned as v4) |
| Deep patch (nested/kind) | Reverses deliberate this-week decisions; no field demand |
| Continuous migration framework | Schema is at 2; one-shot scripts suffice at one consumer |
| Multi-ledger discovery / certification / hostile-writer detection | Second-consumer speculation |
| SQLite read cache | Gated behind program stage 3 re-measurement |
| 20-writer gauntlet | Folded into program stage verification as deterministic interleavings |
| Status-set constant | Drive-by chore for the next PR touching those files |

## Session Log
- 2026-08-17: Initial ideation — 48 generated, 25 after dedupe+synthesis, 5 survived two-skeptic filtering.
- 2026-08-17: All 5 survivors enriched by GPT-5.6 Sol (xhigh); 6 latent defects surfaced; enrichments preserved beside this file.
