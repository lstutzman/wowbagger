---
schema_version: 1
id: wb_01KZFAPQ00MMC9H7PK7RCN9SH7
title: "Let the binary report which build it is"
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
priority: 5
number: 41
decisions:
  - action: accept
    date: 2026-08-08
    summary: "Accepted: the binary cannot say which build it is."
    rationale: "contract_version reports the contract, not the build, so every build implementing contract 1 looks identical, and --version prints an unrelated usage line. This is not a cosmetic gap: it let tinydancer run a build twenty-one commits behind, with no patch and no mint-id, for a whole session. Detecting it required calling capabilities and diffing its operations map against the docs by hand, which only helps someone who already suspects a problem."
  - action: record
    date: 2026-08-08
    summary: "Rank this at priority 5 and give it handle 41."
    rationale: "Diagnostic gaps that hide a wrong build outrank feature work, because every other report from a consumer is suspect until you know which build produced it."
---

Wowbagger cannot say which build it is, so a consumer cannot tell a current
checkout from a stale one.

Verified on this branch:

    $ wowbagger --version
    Usage: wowbagger ready --ledger <dir> --as-of YYYY-MM-DD [--json]
    $ echo $?
    1

`capabilities` reports `contract_version: 1`, which is the **contract's**
version, not the build's. It is 1 for every build that implements contract 1, so
two builds twenty-one commits apart are indistinguishable by it. `package.json`
carries `0.1.0-prealpha` and nothing surfaces it.

**This caused a real, silent, session-long failure.** tinydancer invokes
`node ../wowbagger/bin/wowbagger.js` from a sibling directory. That checkout was
twenty-one commits behind, so the project ran a build with no `patch` and no
`mint-id` for an entire session without noticing. The only way to detect it was
to call `capabilities` and compare its `operations` map against the docs by
hand, which requires already suspecting a problem — and if you suspect a
problem you have already lost the thing a version string is for.

The consumer that hit this is the same one whose earlier report produced items
26 through 33. It found this while upgrading to consume those fixes, which is
the most direct evidence available that the gap is real.

Acceptance:

- an invocation that asks for the version prints a build identity and exits 0;
- the identity distinguishes two builds of the same contract version, so a
  commit or a published release is enough to tell them apart;
- `capabilities` reports the build alongside `contract_version`, since that is
  the surface a machine consumer already calls and the one that must not lie by
  omission; and
- a consumer can answer "am I running the build I think I am" without reading
  the source or diffing an operations map against prose.

Reported from the tinydancer dogfood, 2026-08-08.
