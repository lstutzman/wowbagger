# Capability context design

**Item:** #47 — Disambiguate core and provisioned claim capabilities

## Problem

Wowbagger exposes two capability probes:

- `wowbagger capabilities --json` reports the core mutation contract and its unbound default work-claim profile.
- `wowbagger claim capabilities --ledger <dir> --json` reports the provisioned ledger's work-claim profile.

The JSON envelopes already differ. The claim envelope has `namespace: "work-claim"`, and its backend names the Git journal and ledger binding. The CLI help does not explain this boundary. An operator can compare the shared `mode` and `claim_protected_publication` members, treat the values as contradictory, and stop a valid claimed-work flow.

## Decision

Preserve the version-2 wire exactly. Document the existing machine discriminator and make the human surfaces name each profile.

This avoids a contract-version change. Exact version-2 consumers reject unknown members, so a new `profile` or `scope` field would require a new core contract and an adapter migration. Item #51 owns the separate version-domain problem.

## CLI help

Change the command summaries as follows:

- `capabilities`: describe it as the core contract and unbound default claim profile.
- `claim capabilities`: describe it as the provisioned ledger's claim backend and coordination scope.
- `publish-claimed`: say that publication is available when the ledger-specific claim capability reports `claim_protected_publication: true`. Do not call the command categorically unavailable.

Add short guidance to the `capabilities`, `claim`, and `publish-claimed` command help:

1. Use `capabilities --json` only to negotiate the core mutation contract.
2. Use `claim capabilities --ledger <dir> --json` to gate a claimed-work loop for one ledger.
3. Treat the claim envelope's `namespace` and backend as the machine context discriminator.

Help remains plain text. Existing command outcomes and exit codes do not change.

## Normative contract

Update the mutation and work-claim contracts to state the probe boundary explicitly:

- The core capability envelope reports the unbound default claim profile. It does not prove that a ledger is provisioned.
- The claim capability envelope reports the named ledger's provisioned profile.
- Automation must gate `publish-claimed` on the ledger-specific response.
- `namespace: "work-claim"` and the ledger-bound backend identify the claim contract response.

Do not add, remove, or rename JSON members for item #47.

## Tests

Use the CLI process as the seam.

1. A help test must fail against the current categorical `publish-claimed` text.
2. The test must assert that core help names the unbound profile and points to the ledger-specific probe.
3. The test must assert that claim help names the ledger-specific gate.
4. Existing capability-envelope tests must remain byte-exact and pass unchanged.

## Non-goals

- Do not change `contract_version`; item #51 owns version-domain naming.
- Do not make generic capabilities ledger-aware.
- Do not change claim behavior, provisioning, publication, or error envelopes.
- Do not add an alias or compatibility shim.
