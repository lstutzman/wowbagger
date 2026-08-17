---
date: 2026-08-17
topic: consumer-adoption-evaluation
item: 2
consumer: PropertyCompass2
---

# Evaluation: PropertyCompass adoption of wowbagger

Ledger item #2 ("Evaluate PropertyCompass adoption after standalone release") was filed
2026-08-04 as a gated question: adopt only *after* a versioned standalone release exists and
carries independent migration evidence. It was accepted and deliberately deferred on
2026-08-13 because "current claims are merge-coordinated, not exclusive", and undeferred on
2026-08-17 because "the question this item defers is being answered in production" (#2,
decisions `record` / `accept` / `defer` / `undefer`). This document closes it with the
evidence that overtook it, and evaluates *adoption*, not the migration — the migration left
this repository on 2026-08-17 when #72–#82 were killed as transferred to PropertyCompass2's
own ledger. Every claim names its source; three numbers reach this document from the
orchestrator's brief rather than from this repository, are marked **[stated]**, and are listed
again under "Traceability".

## The arc, dated

| Date | Event | Source |
|---|---|---|
| 2026-08-04 | #2 filed: adoption deferred pending a standalone release | #2 `record` |
| 2026-08-11/12 | 0.1.0-alpha.1 published; #23 done — first installed-skill pilot: one real PropertyCompass2 defect driven end to end on the released core; six product findings | `CHANGELOG.md:524`; #23 `complete` |
| 2026-08-13 | #2 and #21 deferred: migration unauthorized, claims not exclusive | #2 / #21 `defer` |
| 2026-08-14 | 0.1.0-alpha.4 published | `CHANGELOG.md:462` |
| 2026-08-15/16 | Dual-run cycle 1 on alpha.4: 21 creates, 27 transitions, 10 findings (their PR #2196) filed here as #88–#96 | #88–#96 `accept` |
| 2026-08-16 | 0.1.0-alpha.5 published; Darwin declared supported | #83 `complete`; `CHANGELOG.md:198` |
| 2026-08-16 | Cycle 2: field trap 7a and field friction 11 filed as #104/#105 | #104, #105 bodies |
| 2026-08-17 | Cycle 3 on published alpha.5: #113–#116 filed from their 1,574-item staging ledger | #113–#116 bodies |
| 2026-08-17 | 0.1.0-alpha.6 published; contract v3 | `CHANGELOG.md:10`; commit `5ebd40c` |
| 2026-08-17 | #72–#82 killed, transferred to PropertyCompass2's ledger | commits `516ae5d`…`8913944` |
| 2026-08-17 | #21 and #2 undeferred | #21 / #2 `undefer` |

## 1. Did adoption succeed on the consumer's terms?

Yes, on the terms their own audits state, and short of cutover.

- **Their store runs.** A 1,574-item provisioned ledger exists in PropertyCompass2 and is
  mutated from their sessions (#113, #115 bodies; a read-only scan counted exactly 1,574
  items, `docs/ideation/enrichments/2026-08-17-bodybound.md:35`). That satisfies epic #21's
  own definition of done: "a named external consumer runs a released wowbagger, installed
  through a real distribution channel, to coordinate its own work" (#21 body).
- **Their drift audit is clean but for one structural divergence.** Their 2026-08-16 audit
  compared 1,572 legacy cards against 1,574 ledger items: "exactly one status disagreement,
  and it is structural, not drift". Legacy epic #1075 is `in-progress` since 2026-06-16
  while its mirror `wb_01KTSZN100WNMQHWN8EEECR29X` is `backlog` and cannot follow, because
  "Epics never enter in-progress" is a deliberate contract rule (#115 body).
- **Latency stopped being a blocker.** Field measurement: 16–20s wall per create/transition
  on an M4 Max against a ~1,500-item ledger; a 21-create + 6-kill batch with the mandatory
  per-op commits took ~12 minutes serial (#91 body). The profile falsified their own
  hypothesis — not parse/validate, but "89 percent of wall time was one `git show` subprocess
  per committed item in `readGitHeadLedger`". Chunked `git cat-file --batch` took create 15.4s
  to 1.2s and transition 15.4s to 1.3s on the 1,500-item benchmark, 12.8x (#91 `complete`);
  #100 dropped one of the three remaining complete-ledger loads, ~260ms more. Their post-fix
  live figure is **2.33s per mutation [stated]** — the right order of magnitude for 1,574
  items under real session load, not a quiet benchmark.
- **Nine mutations reconciled clean in one day [stated]**, and body round-trips are
  byte-exact: `claim-adopt` moves the authorized revision without writing an item byte, so
  `updated` and the body survive exactly (#113 `complete`; `CHANGELOG.md` alpha.6);
  `body_append` "preserves every existing body byte and the frontmatter" (#116); a patch
  keeps the exact `extensionNodeIdentity` of every member it does not name (#118 `complete`).
- **What did not succeed:** the legacy store is still authoritative. The dual-run is the
  "precursor phase"; the sole-writer phase was #80, now transferred, not done (#80 `kill`).

## 2. What did adoption cost them?

- **The field-report burden.** Cycle 1 produced ten findings in their
  `docs/wowbagger-feedback.md` behind their PR #2196 (every #88–#96 `accept` rationale names
  that report); cycles 2 and 3 produced more (#104, #105, #113–#116 bodies). Three authored
  evidence documents plus their PRs #2184, #2196, #2208, #2209 (#104, #113 bodies).
- **The commit ceremony.** Every mutation on a provisioned ledger must be Git-committed before
  the next mutating command, or the next create/transition refuses
  `claim-store-unavailable`/`stale-write-detected` at exit 6
  (`docs/handoffs/2026-08-16-project.md`, "The operational lesson"). Their 12-minute batch was
  that ceremony, serialized (#91 body). Still unautomated: #123 is accepted, not done.
- **Real workarounds.** Their staging checkout was blocked exit 6 on three items whose
  bodies were hand-edited in a design session and merged; the only documented remedy
  destroyed reviewed work, so they ran a three-step workaround that rewrote `updated` (#113
  body). Correcting a title required an out-of-protocol edit that then made the item
  `unauthorized-revision` and blocked every later mutation — the protocol refused the edit it
  forced (#114 `accept`, body). Four of five of their creates landed at the ledger root:
  `git mv` fails on the untracked file `create` writes, and `validate` passes anyway because
  identity is frontmatter, not path (#104 body).
- **Damage and a near miss.** Their item #1475 was `done` in the ledger while its card read
  `backlog` for a day, because the body had no sanctioned mutation verb (#105 body).
  Separately, `set.body` replaces the whole body, so regenerating a mirrored body from the
  upstream source silently destroys ledger-only content while passing every check — "inspect,
  current revision, well-formed body, CAS satisfied - state committed, ok true" (#116 body).
- **The pause.** #2 and #21 sat deferred 2026-08-13 to 2026-08-17 on a gate that did not
  bind: the deferral cited exclusive dispatch (#2 `defer`), and adoption went ahead under
  merge-coordinated claims regardless.

## 3. What did it prove, and disprove, about wowbagger as a product?

**Proved: the field-report loop is the product mechanism.** Fifteen shipped fixes trace to
consumer field evidence in one week — #88, #89, #90, #91, #92, #94, #95, #96, #104, #105,
#113, #114, #115, #116, #118, each naming its field report in its `accept` rationale.
`docs/ideation/2026-08-17-open-ideation.md:134` records the same count and rejected a
field-report intake verb because "the manual loop drove 15 fixes in a week; a doc template is
the 80% version". Epic #21's undefer, written earlier the same day, counted eleven — the loop
outran its own bookkeeping (#21 `undefer`).

**Proved: only a mirror consumer finds these gaps.** The whole title/body/extensions family
exists because their ledger mirrors a legacy store that keeps changing — the body verb
(#105), title in `patch` (#114), `set.extensions` over a committed declaration (#118),
`body_append` for mirror annotations (#116), the epic derivation model so a mirror compares
derived-against-derived (#115), `claim-adopt` for merged out-of-protocol edits (#113).
Maintainer dogfood on this repository's own 119-item ledger surfaced none of them; when that
dogfood finally ran, what it surfaced was operator error, not tool error (#117 `complete`).

**Disproved: consumer causal claims.** Three diagnoses were wrong and repro-first caught
each. Latency was one subprocess per item, not parse/validate (#91). Reconcile-log residue
never blocked a write — "the git-HEAD check on uncommitted items does" (#96). The
fence-poisoning claim was refuted: "claim-verify was never involved; the real block is
item-outside-layout failing whole-ledger validation" (#104). Their `items_dir` feature
request already shipped as `.wowbagger/layout.json` — "pure discoverability failure"
(`docs/handoffs/2026-08-16-project.md`; #94).

**Disproved: that the documented agent surface worked.** Both adapter surfaces mapped *every*
`inspect` refusal to `core-protocol-error`, so "the documented agent surface could not see the
diagnosis at all" — a pre-existing gate defect their recovery path exposed (#108 `complete`).

**Unproven: exclusive dispatch was never the gate.** #2's deferral rested on it; adoption
happened without it. What shipped instead was honesty — claim capabilities advertise
`write_serialization` (`all-worktrees-of-one-repository`) while
`cross_worktree_coordination` stays `false` with a precise definition (#89 `complete`).

## 4. What remains before their legacy store can retire?

Nothing in this repository's ledger. Eleven items — #72–#82 — were killed on 2026-08-17 under
one ruling: "this item executes in PropertyCompass2's repository against PropertyCompass2's
data, by their agents… The wowbagger-side prerequisites shipped this week" (#72–#82 `kill`;
commits `516ae5d`…`8913944`). The transferred work and the evidence each carried:

| Was | What it requires | Recorded evidence |
|---|---|---|
| #72 | An authorized, quiesced migration window | ~20 concurrent worktrees can write the source |
| #73 | Preserve nine dangling relationship identifiers | inventory-verified |
| #74 | Project 15 terminal dependency conflicts losslessly | plus an in-progress source epic |
| #75 | Derive missing dates from Git evidence | needed for any schema-2 projection of 1,501 cards |
| #76 | Resolve 168 date inversions | "without it the target ledger cannot validate" |
| #77 | Refresh the snapshot to a pinned tip | the live dual-run keeps adding to the source |
| #78 | Project three malformed identities without collision | — |
| #79 | Recovery-hardened baseline-ancestry dates | replaced an invalidated first mapping |
| #80 | The wowbagger-sole-writer proof period | current dual-run is its precursor |
| #81 | Byte-exact source preservation | fixes a demonstrated parser newline defect |
| #82 | The cutover itself | gated on #80 and an explicit Lee decision |

Wowbagger-side the residue is two open items: #38 (no supported platform claim on linux or
win32) and #123 (the commit ceremony they pay daily).

## 5. Recommendation: what the second consumer needs that this one did not

PropertyCompass2 co-developed the product: it filed reports, corrected its own evidence,
absorbed three days of shipping, and its maintainer could rule on ownership. A stranger has
none of that. Four gaps it routed around must close first:

1. **A stranger cannot mutate through the shipped adapter at all.** #120 records, verified in
   source, that "the shipped entrypoints advertise approval support they do not plumb -
   mutations through every shipped adapter dead-end" (#120 `accept`;
   `docs/ideation/2026-08-17-open-ideation.md:120`). PropertyCompass2 drove the core directly
   and never hit it. Filed at priority 1; it belongs there.
2. **A bare install serves a dead version.** `latest` still points at alpha.1 while the
   product ships alpha.6 on `next` (#124 `accept`;
   `docs/ideation/2026-08-17-open-ideation.md:62-63`). This consumer was told the tag.
3. **The ceremony must fold away.** Commit-per-mutation is documented (#88), but a stranger
   meets it as an exit-6 refusal in their first batch. #123 turns the operational lesson into
   product behaviour with an honest `git-commit-failed` outcome.
4. **Conformance must cover the real surface.** #125 exists because the adapter conformance
   gap "let two real adapter defects ship" (#125 `accept`), and #108 proved the documented
   agent surface could hide a diagnosis entirely. A stranger has no field-report channel to
   compensate.

Two smaller consequences of the same asymmetry: no supported platform claim exists off Darwin
(#38, #83), and the gaps this consumer reported as missing features were documentation
failures (#94) — so the first-run walkthrough #71 proved once should be guarded continuously,
not re-audited by hand (#71 `complete`).

**Verdict on #2: adoption succeeded, and the question closes by observation rather than by the
migration it originally gated.** The consumer runs a released wowbagger over 1,574 items with a
one-divergence audit, and that divergence is a contract rule, not a defect. The migration and
the cutover are theirs to run.

## Traceability

Three figures come from the orchestrator's brief for item #2 (`/tmp/brief-2.md`, 2026-08-17) and
have no source in this repository at branch `item-2`: the post-fix **2.33s** per-mutation
consumer measurement, the **nine-mutation clean reconciliation day**, and byte-exact body
round-trips as a *consumer-observed* result. What this repository holds are the maintainer-side
equivalents cited above (#91, #100, #113, #116, #118).

Provenance-hygiene note, worth fixing at the next ledger touch: only #88–#96 carry
`provenance.source: consumer-field-feedback`. #104, #105, #113–#116 and #118 carry
`maintainer-dogfood` although their bodies name PropertyCompass2 field reports as the origin, so
counting field-driven fixes by provenance alone undercounts them by seven.
