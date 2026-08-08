# Integrating Kimi and other OpenAI-compatible harnesses

An OpenAI-compatible API describes model transport. It does not provide an
agent. Wowbagger integration needs what an agent *harness* provides:
repository filesystem access and command execution. This guide states what a
Kimi-hosted agent — including Kimi K3 — or any other OpenAI-compatible host
can do today, and what claiming real compatibility requires. It never claims
compatibility from an API format, and neither may you.

## What a harness must actually provide

From [the adapter contract](adapter-contract.md), the host surface an
integration stands on:

- command execution with argument arrays (no shell), intact stdio, and
  containment — timeouts, output limits, process-tree control;
- guarded-relative filesystem resolution inside the repository workspace;
- instruction input, so the agent can be told how to drive the ledger; and
- optionally, the approval and handoff surfaces for mutating flows.

A hosted model with none of these is a chat endpoint, not an integration
target.

## Path one, available now: drive the core directly

Any tool-capable agent whose harness can run commands can use Wowbagger
today, exactly as this repository's own maintainers do:

```sh
npm install -g github:lstutzman/wowbagger
wowbagger capabilities --json
wowbagger ready --ledger ledger --as-of YYYY-MM-DD
wowbagger mint-id --json
```

Then follow the README's "Upgrading from an earlier wowbagger" section for
the behaviour rules that matter to automation, and CONTRIBUTING.md for the
ledger-maintenance limits. The core's JSON envelopes, exit codes, and
refusal messages are the integration surface; `contract_version` from
`capabilities` is the compatibility gate. Drive mutations through create,
transition, and patch — never by editing frontmatter by hand.

This path carries no adapter guarantees: no negotiated version handshake, no
host-capability verification, no honest outcome mapping when a process dies
mid-mutation. The agent's own discipline substitutes for all three. For a
cooperating agent on one repository, that is often enough.

## Path two, when it must be verifiable: an adapter package

A real compatibility claim requires an adapter. The shared entrypoint
runtime makes one small: [`adapters/codex/`](../adapters/codex/) is the
template — a strict-JSON manifest plus an entrypoint declaring the harness's
honest host profile, riding `src/adapter/entrypoint-main.js`. The shared
conformance vectors already anticipate these targets: their manifests list
`kimi` and `openai-compatible-harness`, and the implementation runner takes
`--target` to report each. The day a Kimi adapter package exists, its
evidence runs with:

```sh
node spec/run-adapter-implementation.js --target kimi
```

## What may not be claimed

- No Kimi or OpenAI-compatible adapter package exists in this checkout.
- The adapter contract's section 10 status table records every platform of
  every adapter as `unverified` until invocation forwarding, path and limit
  guards, and the approval and context surfaces are evidenced.
- "It speaks the OpenAI API" is never evidence. Only the vectors are.
