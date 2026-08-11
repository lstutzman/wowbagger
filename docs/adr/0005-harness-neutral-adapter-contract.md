# ADR 0005: Harness-neutral adapter contract

Status: accepted for standalone v0 adapter design

## Context

Wowbagger has a versioned local CLI and JSON contracts. It must remain usable
without an agent harness. Planned integrations need to work with Claude Code,
Codex, Kimi-hosted agents, and other tool-capable hosts without putting vendor
lifecycle logic in the core.

Model API transport and an agent harness are different things. An
OpenAI-compatible API can send prompts to a model. It does not prove that the
host can inspect repository instructions, resolve safe filesystem paths, run a
local command, preserve standard streams, or obtain approval for a mutation.

The core has deliberate limits. Its mutation backend is not a policy engine,
distributed lock, or Git authority. Work claims are a separate capability, and
the shipped profile is merge-coordinated rather than exclusive. An adapter must
not turn those limits into implied guarantees.

## Decision

Define version 1 of a small harness-neutral adapter contract in
[the adapter contract](../adapter-contract.md). The contract has these
boundaries:

| Layer | Owns | Must not own |
|---|---|---|
| Wowbagger core | Ledger validation, readiness, local mutation capabilities, and core JSON semantics. | Vendor lifecycle logic, model transport, repository instruction discovery, or Git automation. |
| Adapter | Safe translation between a configured host and the fixed core CLI. | A second lifecycle engine, policy ranking, a hidden memory store, or an implied claim. |
| Harness | Workspace access, command execution, instruction inputs, session delivery, and consumer approval. | A claim that API transport gives it filesystem or command access. |
| Model transport | Prompt and response delivery when a host uses one. | A guarantee about hooks, tools, files, commands, or repository authority. |

An adapter discovers a consumer-approved package manifest, uses a fixed
bootstrap command wire to negotiate an adapter version and explicit
capabilities, and maps a structured request only
to the documented core commands with `--json`. It forwards the core exit code
and exact bounded standard-output and standard-error bytes. It uses no shell
string and accepts no arbitrary executable or argument list from a model.

Instruction files are host-provided or consumer-configured inputs. The contract
does not assume any filename, command syntax, hook, MCP server, daemon, or
model vendor. Session handoff is an explicit non-authoritative record, not
hidden persistent memory.

Claims and policy are optional feature names. They are absent unless the core
contract and adapter both advertise the dedicated versioned feature. A caller
must separately inspect the ledger-specific claim capability before it treats
publication as claim-protected; the shipped merge-coordinated profile still
reports `safe_exclusive_dispatch: false`. Git commit, push, install, setup, and
instruction-override authority are absent by default and require separate
consumer approval.

Synthetic fixtures under `spec/fixtures/adapters/` define the common
conformance target. An executable reference runner makes direct-core output
the baseline for equivalence cases, evaluates every declared assertion, and
requires future Claude Code, Codex, Kimi, and generic
OpenAI-compatible-harness adapters
to preserve equivalent observable core behaviour.

## Alternatives considered

### Make Claude Code packaging the public interface

Rejected. It makes one host's instruction names, lifecycle, and extension
mechanisms part of the architecture. Codex, Kimi, and a self-hosted generic
harness would then need to emulate Claude Code instead of using Wowbagger.

### Treat OpenAI-compatible transport as adapter compatibility

Rejected. API compatibility describes messages to a model. It does not supply
an approved repository root, no-follow path handling, command execution, or
standard-stream forwarding. It is useful metadata, not integration evidence.

### Put lifecycle and policy translations in every adapter

Rejected. It would fork validation and readiness semantics between harnesses.
The core CLI and its black-box vectors remain the sole lifecycle authority.

### Require MCP, a daemon, Gastown, or Beads

Rejected. These can be optional delivery mechanisms in a future adapter. They
are not required to discover, invoke, or validate the standalone core.

## Consequences

- Core use remains possible by direct CLI invocation with no adapter.
- Future adapters have one capability-negotiated transport and one common
  conformance suite instead of independently interpreting the ledger.
- Mutation transport is fail-closed without lying about outcome: timeout,
  signal, incomplete streams, containment doubt, or missing/invalid envelopes
  after create or transition starts are `mutation-outcome-unknown` and require
  bounded ID/revision recovery before any retry.
- Command entrypoints have explicit JSON stdin/stdout, cwd, environment,
  process-tree containment, path-identity, approval-binding, and timeout rules.
- Approval, instruction, and handoff carriers use exact schemas and bind the
  executable, workspace, bytes, versions, limits, current revision, and current
  instruction set without hidden context capacity.
- An API-only model host must report that it cannot invoke Wowbagger rather
  than offering a false compatibility claim.
- The contract adds documents, fixtures, a strict deterministic reference
  model, and an executable fixture runner whose assertion evidence cannot be
  satisfied by changing expected fixture values alone. It adds no production
  adapter, plugin, daemon, repository setup, or consumer adoption. All named
  adapter implementations remain unverified.
- Platform support is an evidence claim. An adapter may advertise macOS,
  Linux, or Windows only after it passes the common vectors on that platform.

## Non-goals

- PropertyCompass adoption or any other consumer migration.
- Vendor-specific lifecycle logic in the core.
- Work claims, policy ranking, automatic session persistence, or automatic
  Git authority.
- A required MCP server, daemon, Gastown dependency, or Beads dependency.
