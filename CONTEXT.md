# CONTEXT.md — Wowbagger ubiquitous language

A living glossary of this project's own terms. One term, one meaning. Use these
words exactly; never substitute a generic synonym. If a term gains a second
meaning, flag the collision rather than resolving it silently.

## The ledger

- **ledger** — the directory of Markdown item files that is the whole database.
  Plain Markdown and Git; no service, no schema server.
- **item** — one unit of work: a Markdown file with a YAML frontmatter header and
  a prose body. The atom of the ledger.
- **frontmatter** — the YAML header of an item. Its fields are contract, not
  convenience.
- **body** — the prose below the frontmatter. Holds the problem statement,
  the reasoning, and the acceptance criteria.
- **acceptance** — the checklist at the foot of an item body that defines done
  for that item.
- **provenance** — the recorded origin of an item: who or what surfaced it, and when.
- **decisions** — the append-only record on an item of what was accepted or
  refused, with rationale. It exists to stop a contract changing silently.

## Identity and handles

- **ULID** — the item's immutable canonical identity, `wb_` + 26 Crockford base32
  characters. Filenames, references and publication use it. Caller-generated, so
  publication stays atomic and retry-safe.
- **number** — a short positive integer handle on every item, unique within one
  ledger. **Not identity.** Say "item 30", never the ULID. A duplicate number is a
  recoverable `duplicate-number` validation error, not an identity collision.

## Selection

- **ready** — the command, and the result: the items that may be worked now.
  Deterministic. Ordered by priority-bearing first, then ascending priority, then
  ascending created date, then ascending ULID.
- **priority** — a non-negative integer supplied by a consumer policy. Lower sorts
  first. Core never calculates it.
- **triage** — the status every item lands in on `create`. A triage item is
  excluded from `ready` until a transition accepts it into `backlog`.

## Mutation

- **patch** — the guarded operation that changes exactly `priority`, `number`,
  `parent`, `depends_on`, or `title`, appends a record decision, and uses the
  transition lock and revision compare-and-swap path.
- **transition** — the guarded operation that changes an item's status and appends
  a decision. Holds a per-ID lock and a revision compare-and-swap.
- **compare-and-swap (CAS)** — the revision check that makes a concurrent write
  refuse rather than clobber.
- **publication** — the atomic write of an item to the ledger. No-clobber.

## Coordination

- **claim** — a transient, *advisory* assertion that an agent is working on an item
  right now. Visible across the worktrees of one repository. **Enforces nothing** —
  a non-cooperating writer still wins. Distinct from ownership.
- **fenced claim** — the unbuilt, enforcing form of a claim. Requires one
  transactional coordinator over the claim decision, clock floor, every write path,
  and ledger publication. Open design question.
- **ownership** — durable accountability for an item, as opposed to who is touching
  it now. Deliberately absent from the ledger; claims cover the practical need.

## Contract and conformance

- **contract** — the normative surface a consumer may rely on: `SPEC.md`,
  `docs/mutation-contract.md`, `docs/adapter-contract.md`,
  `docs/work-claim-contract.md`. Changing one is an ADR-worthy act.
- **oracle** — an independent re-implementation under `spec/` or `test/` that the
  production code in `src/` is measured against. `spec/adapter-reference.js` and
  `test/work-claim-reference.js` are oracles. **`src/` must never import from them**;
  collapsing an oracle into its subject makes its conformance tests prove nothing.
- **conformance vectors** — byte-compared fixtures that pin a machine surface.
  `ready --json` is pinned this way, so its bytes must not drift.
- **adapter** — the layer that answers a harness's negotiation surface. The Claude
  Code adapter is the first.
- **harness** — the agent runtime a consumer drives Wowbagger from: Claude Code,
  Codex, opencode, Kimi.

## Practice

- **dogfood** — running Wowbagger on real work to surface friction, then filing that
  friction as items. A **dogfood finding** is an item whose provenance is a dogfood run.
- **handoff** — the document in `docs/handoffs/` that carries state to the next
  session. `HANDOFF.md` points at the current one.
