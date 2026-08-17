---
schema_version: 2
id: wb_01M07J8X15VJR34F9DF92NF1YE
number: 114
title: "Widen patch to title and draw the frontmatter ownership boundary"
kind: task
priority: 2
status: in-progress
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T09:54:02Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Protocol contradiction on published alpha.5: the fence refuses the edit the protocol forces; title is the most-corrected field."
---

Field issue from PropertyCompass2 on published alpha.5 (docs/wowbagger-feedback.md on their side), and it is a protocol contradiction: correcting an item's title REQUIRES an out-of-protocol edit, which then makes the item unauthorized-revision and blocks every later mutation. No verb carries title: create sets it once, patch refuses it as unknown-member, transition does not carry it. Their concrete case: a title wording correction on a mirrored item. The same trap holds for every consumer-owned frontmatter member (their examples: kind, tags, tier). The ownership boundary is currently discoverable only by trying a patch and reading the refusal.

Scope:
1. Widen patch's set to `title`: non-empty schema string, whole-value replace, same lock/CAS/candidate-validation/publication machinery, claimed items refused, updated bumped. Title is the field a consumer corrects most.
2. `kind` stays refused - a task/epic flip has structural consequences (parent and children rules, allowed lifecycle edges) and needs its own design if ever wanted. State that refusal and its reason in the contract rather than leaving it implicit.
3. Decide extension members (tags, tier, and any permitted schema extension): they are caller-supplied at create and #105 deliberately kept them out of patch. If the machinery is genuinely identical to title (whole-value replace of one named extension member, candidate validation already enforcing the permitted-extension rules), include them in the same widening; if any complication surfaces (YAML structure preservation for nested extension values, oracle surface growth), keep them out and record why. Either way the boundary must stop being try-and-see.
4. The boundary table: contract section 9 (or a new subsection) states explicitly which frontmatter members are permanently core-owned (id, number, schema_version, status, created, updated, terminal dates, decisions) versus consumer-editable through patch (priority, depends_on, related, body, title, and the extension decision from scope 3) versus create-once (kind, provenance). Pin the table with a docs guard; the skill teaches the same boundary.
5. Oracle mirror, conformance vectors (title success + refusals), version note appended to the v3 delta list with the same request-schema-widening argument #105 used - but note v3 is now PUBLISHED (0.1.0-alpha.5), so the note must say plainly that a consumer probing for title-patch support cannot distinguish alpha.5 from this build by contract version; the next release is the real carrier.

Acceptance:
- A fixture proves a title-only patch changes the title, bumps updated, and leaves every other byte identical; combined title+body+relations in one CAS write pinned.
- The consumer's exact trap is dead end-to-end: a title correction lands in-band on a provisioned fixture ledger with no unauthorized-revision aftermath.
- The ownership boundary table exists in the contract, guarded by a docs test; the skill states it.
- Oracle and core agree both directions, mutation-guarded; gate green on both runtimes.

## Second occurrence (2026-08-17, same consumer)

One day later, the same shape from ordinary backlog hygiene: three legacy items whose only defect is a wrong or missing identifier field have no ledger-side repair verb at all. Two independent occurrences in two days upgrade scope 3's extension-member decision: consumer-owned identifier fields ride permitted extension members, and "include if trivially the same machinery" becomes "field evidence demands a sanctioned path; if the machinery is not trivial, say what is and split it - but the boundary table must give these fields a named home either way."
