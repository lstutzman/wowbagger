---
schema_version: 2
id: wb_01KZGKSC0SYA74NQN3A5K72PMH
number: 34
title: "Fold patch into the adapter contract at its next version"
kind: task
priority: 30
status: done
created: 2026-08-08
updated: 2026-08-10
completed: 2026-08-10
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-08T12:00:00.000Z"
depends_on: []
related: [ wb_01KZE1GBG0WTJCBR30QKM2GXMK ]
decisions:
  - action: accept
    date: 2026-08-08
    summary: "Accepted: patch must fold into the adapter contract when its version next bumps."
    rationale: "The deferral is deliberate — the version 1 probe pins the operation and command lists exactly, and adapter Plans 2 and 3 evidence that baseline — but it must not be forgotten. The mutation contract points here."
  - action: complete
    date: 2026-08-10
    summary: "patch is advertised and forwarded in adapter contract version 2."
    rationale: "The item was written to fire at the adapter contract's next version. That version arrived with the schema-2 work, so patch was folded in at exactly the moment the item specified."
---

The `patch` mutation shipped in the core CLI (mutation contract section 9)
but the version 1 capabilities envelope and the version 1 adapter core probe
deliberately do not advertise it. Their operation and command lists are
pinned exactly: `operations` must have exactly inspect/create/transition/
work_claim members, and the describe command list must equal the six-command
CORE_COMMAND_ORDER. Widening either is an adapter contract version change,
not a core patch, and mid-flight adapter Plans 2 and 3 evidence the current
baseline.

When the adapter contract next revs:

- add a patch operation to the capabilities envelope and its probe checks;
- add patch to the core command list, its order rule, and the describe
  validation;
- update the oracle, the engine, the vectors, and the two downstream command
  lists together; and
- state the capability members patch advertises (write_scope single-item,
  cas_scope exact-byte-sha256).

Until then the fail-closed direction holds: nothing advertises a capability
that does not exist.

Filed 2026-08-08 while shipping the patch mutation for item 33.
