---
schema_version: 1
id: wb_01KZFAPQ008S65KRCSPRFKX7MP
title: "Refuse an unknown argument instead of printing another command's usage"
kind: task
status: backlog
created: 2026-08-08
updated: 2026-08-08
provenance:
  source: "consumer-dogfood/tinydancer"
  recorded_at: "2026-08-08T10:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
priority: 10
number: 42
decisions:
  - action: accept
    date: 2026-08-08
    summary: "Accepted: one catch-all usage string answers every unrecognised invocation."
    rationale: "--version, --help, an unknown flag and no arguments all print the usage line for ready and exit 1. The string names a command the caller did not mention, advertises one of the eight commands that exist, and exits with a code the contract table does not define. Printing something that looks like output is what stopped a wrong invocation from announcing itself."
  - action: record
    date: 2026-08-08
    summary: "Rank this at priority 10 and give it handle 42."
    rationale: "Diagnostic gaps that hide a wrong build outrank feature work, because every other report from a consumer is suspect until you know which build produced it."
---

Every unrecognised invocation prints the usage line for `ready` and exits 1,
whatever was actually asked for. Verified on this branch:

    $ wowbagger --version   -> Usage: wowbagger ready --ledger <dir> ...   exit 1
    $ wowbagger --help      -> Usage: wowbagger ready --ledger <dir> ...   exit 1
    $ wowbagger --mystery   -> Usage: wowbagger ready --ledger <dir> ...   exit 1
    $ wowbagger            -> Usage: wowbagger ready --ledger <dir> ...   exit 1

One catch-all answers four different questions, and it names `ready` — a command
the caller did not mention. A reader asking for a version is told how to run a
query they did not request, which reads as though the tool misunderstood them
rather than as a refusal.

The cost is not cosmetic. This is what let a stale build go unnoticed for a
session: `--version` did not say "no such flag", it printed something that looks
like output, so nothing signalled that the question had not been answered.
Tracked separately as the build-identity item.

Two further problems in the same string:

- It advertises only `ready`, so `capabilities`, `inspect`, `create`, `patch`,
  `transition`, `validate` and `mint-id` are undiscoverable from the CLI itself.
  A consumer's first contact with the tool lists one seventh of it.
- Exit 1 is not in the contract's exit table, which defines 0, 2, 3, 4, 5 and 6.
  An argument failure has a documented code — invalid-request at exit 2 — and
  every JSON command already uses it. The bare CLI does not.

Acceptance:

- an unknown argument is refused as an unknown argument, naming what was not
  recognised;
- the refusal uses a documented exit code, or the contract states the one it
  uses;
- usage output lists the commands that exist rather than one of them; and
- asking for help is not an error.

Reported from the tinydancer dogfood, 2026-08-08.
