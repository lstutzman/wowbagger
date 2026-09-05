---
schema_version: 2
id: wb_01M1QDTV00SVMAFD1ECT024930
number: 205
title: "Handle closed stdout pipes without a stack trace"
kind: task
priority: 20
status: triage
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 21"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: []
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
  - "cli"
---

## Problem

Piping large JSON output to a consumer that exits early, such as `head`, can raise an unhandled `EPIPE` and print a Node.js stack trace. The command should terminate quietly when standard output is intentionally closed.

## Reproduction

Run a command with nontrivial output through an early-closing reader, for example `wowbagger inspect --ledger ledger --number 1 --json | head -c 1`. The consumer closes the pipe before Wowbagger finishes writing and the CLI emits an uncaught `EPIPE` stack trace.

## Acceptance criteria

- A closed stdout pipe terminates without a stack trace or secondary diagnostic.
- The process uses a stable documented exit behavior for `EPIPE`; it does not report a successful complete JSON envelope.
- Real serialization, filesystem, and command failures retain their current envelopes and exits.
- A child-process fixture closes stdout early and proves stderr remains empty.
