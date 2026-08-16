---
schema_version: 2
id: wb_01M05ESTD06WY3182N3BA4SWVA
number: 101
title: "Teach the skill the in-band dependent-disposition flow"
kind: task
priority: 10
status: in-progress
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T14:14:53Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "Lee accepted on 2026-08-16. Skill gap: agents read the skill, not the contract."
---

Follow-up from item #90: the installed skill never teaches the new in-band disposition flow. It still says only that `patch` refuses `number`; it mentions neither `dependent-disposition` nor that patching a dependent's `depends_on` onto `related` is now the sanctioned way past that refusal. Agents hitting the friction read the skill, not the mutation contract.

Scope: one short addition to skills/wowbagger/SKILL.md in the Writing section — patch edits priority, depends_on, and related (whole-list replace, [] to clear, number refused); when a kill refuses `dependent-disposition`, re-scope the dependent with a relations patch, then retry the disposition. Pin with a docs guard test alongside the existing skill pins.

Acceptance:
- The skill names the patchable field set and the dependent-disposition escape; a docs test pins both.
- Gate green on both runtimes.
