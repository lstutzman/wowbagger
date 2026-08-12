---
schema_version: 2
id: wb_01KZVSW80HMW6RM39MX90P1TSH
number: 53
title: "Publish an immutable plugin release artifact"
kind: task
priority: 10
status: backlog
created: 2026-08-12
updated: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood"
  recorded_at: "2026-08-12T20:16:45Z"
depends_on: []
related: [ wb_01KZBT447HVZ9798DXV1NTT515, wb_01KZBT43RZSKMG8Z19RQQ43DDR, wb_01KZV3X9QNRH2RJABFPKVW7X7V ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept the immutable-release defect at priority 10."
    rationale: "The named alpha.1 tag and the plugin bytes installed from main disagree, so the consumer run is attributable but not reproducible."
---

The PropertyCompass2 consumer dogfood installed plugin version `0.1.0-alpha.1` from unpinned `main` at commit `c2447d6e18df77657ca022281d5d9be89c46bc7f`. The release tag `v0.1.0-alpha.1` points at `faee90c695dfc57a8c2376352ef0035f7494c2fa`, where `.claude-plugin/plugin.json` still reports `0.1.0-prealpha`. The npm release is named, but the plugin install is attributable only by a moving branch SHA and cannot be reproduced from the named tag.

Done means one new immutable release names the same bytes across npm, Git, plugin manifest, and marketplace metadata; the marketplace plugin source resolves to that immutable release; and the release gate verifies the tagged plugin payload before publication. Do not move the existing tag silently.
