---
schema_version: 2
id: wb_01KZGRWCNZGEXR4WRYH3MNTYN9
number: 36
title: "Give the CLI --help and --version surfaces"
kind: task
priority: 20
status: backlog
created: 2026-08-08
updated: 2026-08-08
provenance:
  source: "consumer-dogfood/tinydancer"
  recorded_at: "2026-08-08T14:30:00.000Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-08
    summary: "Accepted from the tinydancer dogfood: the CLI has no help or version surface."
    rationale: "A consumer asked whether in-flight work covered --help and --version; nothing did. Usage strings are only reachable by error, and no surface prints the distribution version the release path defines. Accepted at the dogfood-friction priority tier."
---

The CLI has no `--help` and no `--version`. A consumer discovering the tool
meets per-command usage strings only by getting arguments wrong, and there
is no global command inventory at all. `capabilities` reports
`contract_version` — the behavioural version — but nothing prints the
distribution version an installed core came from, which the release path
(docs/adapter-release-path.md) says is the repository tag mirrored in
package.json.

Raised by the tinydancer consumer dogfood while asking whether in-flight
work covered this; none did, so this item makes it real.

Acceptance:

- `wowbagger --help` prints the command inventory and exits 0;
- `wowbagger <command> --help` prints that command's usage and exits 0;
- `wowbagger --version` prints the package version and exits 0;
- machine surfaces are untouched — the JSON contracts, exit codes, and
  usage-error refusals for genuinely wrong arguments do not change; and
- the README's core-commands section points at --help where the commands
  are introduced.

Conventions worth mirroring, from the Claude Code CLI reference
(https://code.claude.com/docs/en/cli-reference), supplied by Lee when this
item was filed: per-command help reached through the same help surface
(`wowbagger patch --help`), and a typo suggestion on an unknown command
("Did you mean wowbagger transition?") instead of the bare usage throw.
The suggestion is an option, not an acceptance requirement.
