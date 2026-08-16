# The consumer configuration layer

Version 1. This states how a consuming repository binds the core to its own
layout without forking it: what a consumer declares, where the core reads
it, what absence means, and what may never be configured.

## What a consumer declares

Exactly one thing binds the core to a repository: the ledger directory,
supplied explicitly on every invocation as `--ledger <dir>`. There is no
configuration file, no environment variable, and no discovery walk in
version 1. The party that knows the repository — a human, a skill, an
adapter configuration — owns that binding and states it on each call.

Everything else the word "configuration" usually covers lives on the
consumer's side of the seam:

- **Paths and naming**: the ledger directory is whatever the consumer
  chooses, and item filenames follow the identity-derived default. Where
  inside the ledger those files land is bound by the committed
  `<ledger>/.wowbagger/layout.json` (mutation contract section 7), not by a
  rename after create. Creating that directory is the consumer's job:
  `create` publishes into it and never creates it, and refuses
  `items-directory-unavailable`, exit 2, naming the directory, when it is
  missing.
- **Branch names and Git policy**: out of core scope permanently. The core
  performs no Git operations; ADR-0001 keeps branch policy with the
  consumer.
- **Branding and display**: consumer views. The core's human surface is
  deliberately plain; anything richer is derived output in consumer space.
- **Ranking policy**: the policy-input contract
  ([policy-input-contract.md](policy-input-contract.md)) — priority values
  and extension members, never core configuration.
- **Instructions to agents**: the skill or its per-harness equivalent, which
  is where a repository states its own ledger path and conventions.

## Why the core reads no consumer configuration file

A configuration file the core discovered and obeyed would be an implicit
input steering validation and mutation — the same class of hazard as an
arbitrary create path, and the reason both are refused. Explicit
per-invocation binding keeps a cloned, hostile, or misconfigured repository
from redirecting the core silently, and keeps every invocation reproducible
from its command line alone.

Two repository-local artifacts are deliberately not consumer configuration.
`.wowbagger/namespace`, written by `provision` and read by the claim commands,
is core-owned state with its own contract. `.wowbagger/layout.json` is
core-owned ledger structure: it binds item placement inside the ledger under
SPEC.md and the mutation contract, is read from the ledger the caller named
rather than discovered by a walk, and can express nothing but a validated item
directory.

## Absence

A missing `--ledger` is a usage error before any read. A `--ledger` naming
a missing or unreadable directory is the fail-closed
`ledger-read-error` validation result. Nothing defaults, guesses, or walks
upward.

## What may never be configured

Anything that would change ledger validity or core selection: the schema
and its field rules, status vocabulary and lifecycle edges, readiness
membership, the four-step ready order, identity format, revision and lock
semantics, and refusal behaviour. These are the contract. A deployment that
wants them different wants a different tool, not a configuration value.

## Reopen trigger

If real consumers accumulate invocation friction that explicit `--ledger`
cannot reasonably carry, a repository-local binding file (for example
`.wowbagger/config.json` naming only the ledger directory) may be specified
— by ADR, before implementation, constrained to naming locations and never
semantics, per the discipline in ADR-0006.
