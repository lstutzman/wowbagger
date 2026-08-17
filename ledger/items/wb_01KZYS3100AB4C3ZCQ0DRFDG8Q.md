---
schema_version: 2
id: wb_01KZYS3100AB4C3ZCQ0DRFDG8Q
number: 71
title: "Turn the README into an accurate adoption and collaboration guide"
kind: task
priority: 2
status: done
created: 2026-08-14
updated: 2026-08-17
completed: 2026-08-17
provenance:
  source: "user-request"
  recorded_at: "2026-08-14T12:49:26.000Z"
depends_on: []
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog at triage review."
    rationale: "Standalone user-requested documentation and adoption work, independent of the migration; README accuracy is a live liability with alpha.4 published."
  - action: complete
    date: 2026-08-17
    summary: "The README is an accurate adoption and collaboration guide."
    rationale: "Full audit: 23 wrong, understated, or missing claims corrected against HEAD, each verified by a named command or file - including three sites carrying a stale conformance count that no test guarded (a derived guard now pins all three against the vectors). Clean packaged-install walkthrough proven end to end: install, layout and extensions declarations, create, accept, patch title+priority+body_append+extensions, ready, validate, provision. The exit-6 envelope in the README reproduced member for member. Contributor route from ledger item to the four-command gate. Mascot: three original directions evaluated, Patient Comet recommended, NOTHING adopted - human approval outstanding. Found for the maintainer: LICENSE says Apache-2.0 while package.json and plugin.json publish MIT - a licensing decision, deliberately not made here."
---

# Problem

The README must serve two purposes without compromising either one. It must remain an accurate entry point to the core, adapter, and skill contracts. It must also persuade qualified users to adopt the Wowbagger skill. Outdated release, capability, installation, or limitation text will undermine both purposes. The README does not yet give collaborators a clear path to useful work or establish a distinctive visual identity.

# Required outcome

Audit every README claim against the current package, CLI, adapter contracts, shipped skill, ledger decisions, and release state. Remove obsolete text. Correct stale text. Keep deep protocol detail in linked documents instead of turning the README into a second contract.

Restructure the opening so a new reader can answer these questions without prior context:

- What problem does Wowbagger solve?
- Who should use it?
- Why should an agent or maintainer adopt the skill instead of editing a Markdown backlog directly?
- What is available now, and what remains experimental, unverified, merge-coordinated, or deferred?
- What is the shortest verified path from installation to useful work?

Use compelling, concrete language. Lead with outcomes: a reviewable Markdown ledger in Git, deterministic ready selection, guarded lifecycle writes, honest capability discovery, and a skill that teaches agents to use those guarantees correctly. Distinguish the core, adapter, skill, and plugin. Never present a merge-coordinated claim as an exclusive lock or advertise a capability that the current release cannot prove.

Add a collaborator section that explains:

- which contributions are useful now;
- how to select work from the ledger and inspect its acceptance criteria;
- how to run the required checks on the current Node runtime and Node 20;
- the independent-oracle and normative-fixture rules;
- how to report dogfood friction, documentation drift, platform evidence, and reproducible defects; and
- how to propose changes without weakening compatibility, safety, or claim honesty.

Explore a mascot that makes the project recognizable. The name may inspire a tone of cosmic scale, dry absurdity, and stubborn record-keeping, but the result must be original. Do not copy characters, costumes, logos, quotations, typography, or other recognizable material from The Hitchhiker's Guide to the Galaxy. Nano Banana may generate concept images. Preserve each selected prompt and generation provenance. A human must approve the final concept before it enters the README or repository branding.

# Acceptance criteria

1. A written audit maps each existing README section to keep, update, move, or remove, with the source that verifies every changed factual claim.
2. The first screen states the value proposition, intended users, current maturity, and one primary adoption action.
3. A concise "Why adopt the skill" section explains the concrete safety and workflow benefits without marketing unsupported guarantees.
4. Installation and quick-start commands are current, copyable, and verified from a clean packaged installation.
5. Status and limitations match the current release, claim capability profile, platform evidence, and skill distribution state.
6. A collaborator section gives a new contributor an exact route from choosing an item through the repository verification gate.
7. Deep contract detail moves behind clear links when it obscures the README's adoption path. Required warnings stay visible where a user makes the relevant decision.
8. At least three original mascot directions are evaluated against recognizability, readability at small sizes, accessibility, repository tone, and intellectual-property risk. If an image is adopted, its source prompt, provenance, optimized asset, and meaningful alt text are committed.
9. The final README contains no broken internal links, stale versions, dead commands, copied Hitchhiker's Guide material, or claims contradicted by source, contracts, capabilities, fixtures, or the ledger.
10. Relevant documentation and packaging tests prevent release, installation, command, and status guidance from drifting again.
11. The complete repository verification gate passes on the current Node runtime and Node 20.

# Scope constraints

- Keep the README useful as a landing page. Do not duplicate full contracts or turn it into a complete reference manual.
- Use marketing language to explain proved value, not to hide limitations.
- Treat mascot generation as concept exploration, not automatic permission to publish an image.
- Do not change product behavior, capability envelopes, or compatibility rules to make README copy easier to write.
