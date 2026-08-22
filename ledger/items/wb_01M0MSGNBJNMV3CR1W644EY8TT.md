---
schema_version: 2
id: wb_01M0MSGNBJNMV3CR1W644EY8TT
number: 136
title: "Preserve exact leading LF bytes in patch body replacement"
kind: task
priority: 2
status: triage
created: 2026-08-22
updated: 2026-08-22
provenance:
  source: "propertycompass2-field-report-msg-fffb996b3be5"
  recorded_at: "2026-08-22T13:10:52.057Z"
depends_on: []
related: [wb_01M05FJKJFKMHHTS3YMBAG3WXC]
---

## Problem

PropertyCompass2 alpha.6 patched the bodies of #648 and #1484 with `patch.set.body` strings beginning with exactly two LF bytes. Both successful CAS-fenced publications began the stored body with three LFs. Sending one fewer LF in a second patch restored byte parity.

The mutation contract and completed item #105 state that body replacement writes caller bytes exactly after the closing frontmatter delimiter and that empty, one-leading-LF, and other LF-leading strings are distinct. An automatic separator LF therefore violates the public byte contract and forces consumers to compensate with an undocumented off-by-one transformation.

## Scope

1. Reproduce on the current core with body replacements containing zero, one, two, and three leading LF bytes; inspect and hash the exact stored body after each CAS write. Run the same matrix on items whose original body is empty, begins immediately after the delimiter, and begins with a conventional blank line.
2. Trace the splice boundary through `bodyRegion`, `replaceBody`, frontmatter delimiter handling, YAML rewrite, and publication. Fix the layer that owns the extra byte; do not special-case PropertyCompass requests.
3. Preserve every frontmatter byte except the controlled `updated` change, including original line endings, BOM behavior, anchors, aliases, and extension nodes.
4. Align `set.body_append`: append bytes must begin immediately after the current body and must not inherit or insert a separator beyond the request.
5. If current alpha.7 already preserves exact bytes, add a regression matrix that proves the alpha.6 behavior cannot return and document the release boundary; do not change production code without a failing current reproduction.
6. Keep request JSON semantics explicit: JSON `
` decodes to one LF byte; no layer normalizes Markdown blank lines.

## Acceptance criteria

- Normative fixtures cover replacement bodies with zero, one, two, and three leading LFs and assert exact decoded body bytes plus complete item revision.
- Matching append fixtures cover an empty current body and LF-leading append payloads.
- A mutation test that inserts one separator LF makes the focused suite fail.
- Frontmatter identity tests prove only `updated` changes and no comment/anchor/extension byte is rewritten by the body splice.
- Default create body semantics and inspect body extraction remain unchanged.
- Mutation contract, JSON Schemas, installed skill mirror guidance, and independent oracle agree on exact-byte behavior.
- Current Node and Node 20 gates pass.

## Evidence

Orca message `msg_fffb996b3be5`, PropertyCompass2 feedback log section `2026-08-22 — #648 targeted backlog split`. Requests for #648 and #1484 carried two leading LFs; published bodies carried three; compensating with one fewer LF restored parity.
