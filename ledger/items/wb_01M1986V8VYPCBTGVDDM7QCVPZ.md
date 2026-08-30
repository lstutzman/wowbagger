---
schema_version: 2
id: wb_01M1986V8VYPCBTGVDDM7QCVPZ
number: 188
title: "Move supported runtime and release gates to Node 24"
kind: task
priority: 1
status: triage
created: 2026-08-30
updated: 2026-08-30
provenance:
  source: "Node 24 migration investigation"
  recorded_at: "2026-08-30T12:00:00Z"
depends_on: []
related: [ wb_01M14Y2VZW2ASKHYE42BGZ1PPK ]
---
## Problem

Wowbagger still publishes `engines.node: >=20`, exports `MINIMUM_NODE_MAJOR = 20`, runs every native CI platform only on Node 20, and documents a current-plus-Node-20 release gate. Node 20 reached end-of-life on 2026-04-30. Node 24 is Active LTS through 2026-10-20 and supported through 2028-04-30. The supported floor and the evidence matrix should move to Node 24 rather than continuing to certify an end-of-life runtime.

Lee stated that another project has found a Vitest/Node 26 incompatibility. Treat that as Lee's stated fact, not a Wowbagger reproduction: exclude Node 26 from the supported gate until the Vitest-side issue is resolved elsewhere. Wowbagger itself uses `node:test`, not Vitest.

## Investigation evidence — 2026-08-30

- Homebrew `node@24` stable is 24.20.0. It is installed keg-only at `/opt/homebrew/Cellar/node@24/24.20.0`, with `/opt/homebrew/opt/node@24/bin/node` resolving there; the machine default remains the NVM Node 20.20.2.
- Toolchain: Node 24.20.0, npm 11.19.0, Corepack 0.35.0.
- Full Wowbagger suite: 1819/1819 under Node 24.20.0.
- Strict deprecation gate with `--pending-deprecation --throw-deprecation`: 1819/1819.
- Adapter implementation conformance passed; ledger validation returned valid with core contract 5; `npm audit` found zero vulnerabilities.
- A clean archive completed `npm ci` under npm 11.19.0.

## Acceptance criteria

- Raise the published `engines.node` floor and exported `MINIMUM_NODE_MAJOR` from 20 to 24 with request/launch tests updated first.
- Change Linux, Windows, and macOS CI from Node 20 to Node 24; keep the native platform-evidence semantics unchanged.
- Define one explicit release matrix that excludes Node 26 until Lee's stated Vitest incompatibility is resolved elsewhere. Record exact runtime version strings in every release-gate report; stop using the ambiguous label `current Node`.
- Update release tooling to invoke the Node 24 runtime deliberately, including unit suites, adapter vectors, ledger validation, packaging, and tag verification. Do not rely on whichever `node` happens to lead `PATH`.
- Update README, host contract, installed skill, ADR 0002, adapter release path, and current project instructions. Do not rewrite historical handoffs or past gate evidence.
- State the install-breaking consequence in CHANGELOG and release notes: users on Node 20/22 no longer satisfy the package engine.
- Add `.nvmrc` or the repository's chosen equivalent pin for developer shells without changing the machine-wide default as part of the repository change.
- Run full Linux, Windows, and macOS Node 24 CI plus local Node 24.20.0 full, strict-deprecation, adapter, ledger, audit, and cold-install gates before release.

## Triage decision — 2026-08-30

Accepted into backlog at priority 1. Node 20 is already end-of-life, while the machine-wide Node 24.20.0 probe passed 1,819 tests, the strict pending-and-throw deprecation gate, adapter conformance, ledger validation, audit, and a cold npm 11 install. Lee's Node 26/Vitest incompatibility remains a stated external constraint, not a Wowbagger reproduction.

First implementation slice: write failing tests for the published engine floor, exported minimum major, CI matrix, and release-runtime selection; then move those surfaces to Node 24 without touching historical gate records or the machine default. Node 26 remains excluded until Lee's external constraint is cleared.
