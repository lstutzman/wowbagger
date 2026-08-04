# ADR 0002: Read-only CLI runtime

Status: accepted for standalone v0

## Context

The first executable Wowbagger capability is deliberately narrow: read a local
Markdown ledger, validate it, and return a deterministic ready set. The runtime
must be easy to install, small enough to audit, and independent of any agent
harness or consumer repository.

## Decision

Use modern Node.js ESM with Node 20 or later, the built-in `node:test` runner,
and one runtime dependency: the current `yaml` npm package. The CLI is a thin
Node entry point over small ESM modules. There is no TypeScript compiler,
transpilation step, adapter, service, or PropertyCompass integration.

`package-lock.json` records the resolved dependency graph, and `npm ci` is the
reproducible installation command.

## Alternatives considered

### Go

Go would produce a single binary and has strong standard-library filesystem
support. It adds a compiled release and cross-platform distribution decision
before the project has established its public read-only contract. YAML parsing
would still require a dependency. Revisit when a versioned binary distribution
or stronger single-file deployment requirement becomes real.

### Python

Python has concise filesystem code and mature YAML libraries, but a portable
CLI would need an environment, dependency installer, and interpreter-version
story. Those choices are not simpler than the Node runtime already common in
agent development environments. Revisit if future users need a Python-native
embedding API more than a standalone command.

### TypeScript

TypeScript improves static tooling but requires a compiler or runtime loader,
generated artifacts, and a source-versus-distribution policy. The current core
is small enough for direct ESM plus executable tests to remain auditable.
Revisit if the implementation grows enough that static type checking materially
reduces change risk.

### Modern Node.js ESM

Node offers a direct executable CLI, built-in test runner, standard filesystem
APIs, and a current maintained YAML parser without a compile step. ESM keeps
module boundaries explicit and avoids dual CommonJS/ESM packaging. This choice
is a runtime decision, not a schema or adapter contract: any later
implementation must preserve the public CLI behaviour and SPEC.md invariants.

## Consequences

- The supported runtime floor is Node 20.
- Installation is `npm ci`; test execution is `npm test`.
- YAML is intentionally the sole runtime dependency and is pinned by the lock
  file.
- The implementation remains replaceable because ledger format, error contract,
  and CLI JSON are specified independently in SPEC.md.
