# CONTEXT.md — ubiquitous language

One line per term. This is a glossary, not documentation.

- **core** — the `wowbagger` CLI itself (validate, ready, inspect, create, transition, patch, mint-id, claims); harness-neutral, knows no vendor.
- **ledger** — the directory of one-Markdown-file-per-item that is the backlog; this repo's own lives in `ledger/`.
- **item** — one backlog entry: YAML frontmatter (identity, lifecycle, relations) plus a Markdown body.
- **number / handle** — the short integer humans say ("item 30"); never identity — the ULID is identity.
- **ready** — the deterministic queue of actionable items: priority first, then created date, then ID.
- **triage** — where every created item lands; a deliberate accept transition moves it to backlog.
- **harness** — the agent runtime an agent lives in (Claude Code, Codex CLI, opencode).
- **adapter** — per-harness machinery that lets an agent drive the core safely: negotiation, capability checks, forwarding, honest outcome mapping; owns no lifecycle logic.
- **skill** — harness-native instructions telling an agent when and how to use wowbagger; Claude Code packages these in the plugin, other harnesses use their own formats.
- **plugin** — the Claude Code distribution wrapper (marketplace + skill + adapter), self-hosted from this repo.
- **oracle** — `spec/adapter-reference.js` (and `test/work-claim-reference.js`): independent re-implementations that conformance tests compare against; never merged with `src/`.
- **claim (advisory)** — "who is touching this right now"; visible across worktrees, enforces nothing.
- **fenced claims** — the future transactional-coordinator protocol (item 17); unresolved design question.
- **dogfood** — using wowbagger on its own backlog (maintainer-dogfood) or a consumer's (consumer-dogfood/tinydancer).
- **decision record** — the `decisions:` entries on an item; why a lifecycle edge happened, written at transition time.
- **schema migration** — the one-time maintenance tool that changes a complete ledger from schema version 1 to schema version 2.
- **quiesced window** — a maintenance period in which all processes and people that can write the target ledger are stopped.
- **Herdr** — the terminal workspace manager that keeps this repository's panes, agents, and sessions persistent and observable.
