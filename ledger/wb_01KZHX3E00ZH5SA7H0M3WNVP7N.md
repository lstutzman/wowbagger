---
schema_version: 1
id: wb_01KZHX3E00ZH5SA7H0M3WNVP7N
number: 38
title: "Earn a supported platform claim on linux and win32"
kind: task
status: triage
created: 2026-08-09
updated: 2026-08-09
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-09T13:31:00.000Z"
depends_on: [wb_01KZ77NSW8ZP1289HFMN2ECNXD]
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
---

Item 13 requires the conformance run to be reported on one real native platform.
That is the bar for closing item 13, and darwin will meet it. It is not the same
as every adapter manifest declaring `supported` on all three platforms, which is
what a consumer installing on linux or Windows actually needs.

Section 3.1 makes `supported` an evidence-based claim: a manifest may not assert
it without native common-vector evidence. Today every platform in every
`adapters/*/wowbagger-adapter.json` reads `unverified`, which is honest and must
stay that way until a native run exists.

The work is to obtain that evidence per platform, not to edit the manifests:

- run the implementation runner natively on linux and on win32;
- confirm the equivalence cases still preserve exact core bytes there, where
  path syntax and line endings differ most;
- only then move each platform off `unverified`, one platform per piece of
  evidence.

Windows is the sharp edge. The entrypoint is a Node command precisely so the
win32 claim can be earned at all, and case 12 already carries drive, UNC, device,
and volume path refusals that no darwin run exercises for real.
