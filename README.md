# wowbagger

**The backlog may be infinite. The next issue should not be ambiguous.**

Wowbagger is harness-neutral backlog coordination for coding agents, built on
plain Markdown and Git. It is intended to give agents durable work memory,
dependency-aware task selection, and auditable multi-worktree coordination without
putting a database or hosted service inside your repository.

> **Status: pre-alpha.** Wowbagger is being specified and built as a standalone
> project from production lessons. No stable release or installation path exists
> yet; consumer adoption is a later, separate decision.

## Why the name?

Wowbagger the Infinitely Prolonged is a Douglas Adams character faced with an
absurdly large, strictly ordered list and the prospect of working through it
one entry at a time.

That is also a fair description of software maintenance.

The project is an independent literary nod and is not affiliated with or
endorsed by Douglas Adams' estate.

## The problem

Coding agents lose context. They are restarted, compacted, moved between
worktrees, or replaced by a different model. A useful backlog therefore cannot
live only in one conversation or one harness's private state.

Wowbagger makes the repository the durable coordination boundary:

- One inspectable Markdown file per backlog item.
- YAML metadata for lifecycle, priority, dependencies, and ownership.
- Git history as the audit log and recovery mechanism.
- Dependency-aware ready queues so an agent can ask what is actionable now.
- Capability-aware work claims and guarded transitions for concurrent agent sessions.
- Mechanical validation and derived reports instead of duplicated status data.

## Harness-neutral by design

Claude Code is an adapter, not the architecture. The core schema and command
interface will not depend on Claude-specific hooks, slash commands, paths, or
environment variables.

```mermaid
flowchart TD
    Claude[Claude Code adapter] --> Core[Wowbagger core]
    Codex[Codex adapter] --> Core
    Other[Kimi and other tool-capable agents] --> Core
    Core --> Markdown[Markdown and YAML backlog]
    Core --> Git[Git coordination and history]
```

The initial compatibility targets are:

- Claude Code
- OpenAI Codex
- Kimi and other OpenAI-compatible model APIs hosted in agent harnesses that
  provide repository filesystem and command-execution tools

An OpenAI-compatible API describes model transport; it does not by itself
provide agent tools. Wowbagger integrations will document the host capabilities
they require rather than pretending API compatibility guarantees harness
compatibility.

## Design principles

1. **Markdown is canonical.** Humans can inspect and edit the backlog using
   ordinary repository tools.
2. **Git provides auditability and conflict detection.** Do not introduce a
   second version-control system or an opaque synchronization layer.
3. **Derived state stays derived.** Ready queues, epic progress, and reports are
   computed rather than stored twice.
4. **Mechanism and policy are separate.** Lifecycle and scoring machinery can
   be reused while each host repository keeps its own priorities and vocabulary.
5. **Adapters stay thin.** Harness packaging translates into the stable core;
   it does not fork core behavior.
6. **The implementation remains auditable.** Coordination tooling should be
   small enough for a human to understand and repair.

## Planned repository shape

```text
adapters/       Harness-specific packaging and instructions
docs/           Integration and operating guidance
scripts/        Harness-neutral commands
skills/         Portable agent workflows
spec/           Backlog schema, lifecycle contract, and synthetic fixtures
templates/      Backlog item templates
tests/          Shared black-box compatibility fixtures
```

The layout may change before the first release. The separation between the core
and its adapters will not.

## What Wowbagger is not

- An autonomous software factory or agent scheduler.
- A hosted issue tracker.
- A hidden agent-memory database.
- A Claude Code-only plugin.
- A replacement for engineering judgment about what should be built.

It is the durable work ledger beneath those systems.

## Roadmap

- Publish a standalone Markdown ledger contract and synthetic compatibility
  fixtures.
- Provide read-only validation and deterministic ready selection before mutable
  coordination.
- Separate optional reusable mechanisms from consumer-specific policy.
- Provide stable machine-readable commands and compatibility fixtures.
- Ship Claude Code and Codex adapters.
- Document the generic tool contract for other agent harnesses.
- Treat any PropertyCompass adoption as a later, separately-scoped consumer
  project.

## Contributing

The project is at the architecture and contract stage. Issues describing
concrete portability requirements, coordination failures, or harness-integration
constraints are welcome. Please avoid proposing harness-specific behavior in the
core when it can live in an adapter.

## License

Licensed under the [Apache License 2.0](LICENSE).
