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
- **fenced claims** — item 17's accepted work-claim protocol; provisioned Git ledgers implement the `merge-coordinated` profile with claim-protected publication and `safe_exclusive_dispatch: false`, not the strict transactional `fenced` profile.
- **commit-per-mutation invariant** — on a provisioned ledger, every mutation must be Git-committed before the next mutating command; the loop is write, commit, `claim-verify`, next write.
- **ledger graph** — the report's force-directed 3D view of the whole ledger: items as nodes sized by unblocking leverage, `depends_on` and `parent` as edges; part of the report, never a separate artifact.
- **roster** — the ledger graph's per-node list in the same section; where the graph's decision-relevant content lives when WebGL is missing.
- **band** — a node's colour class in the ledger graph: readiness state for open items, terminal status for closed ones.
- **dogfood** — using wowbagger on its own backlog (maintainer-dogfood) or a consumer's (consumer-dogfood/tinydancer).
- **decision record** — the `decisions:` entries on an item; why a lifecycle edge happened, written at transition time.
- **schema migration** — the one-time maintenance tool that changes a complete ledger from schema version 1 to schema version 2.
- **quiesced window** — a maintenance period in which all processes and people that can write the target ledger are stopped.
- **Herdr** — the terminal workspace manager that keeps this repository's panes, agents, and sessions persistent and observable.
- **claim-fence refusal** — a `ledger-mutation` response refusing a `create`/`transition`/`patch` before the core mutation ran; state-unchanged classes are deterministic and forwarded verbatim, never mutation-outcome-unknown.
- **response domain** — which contract a CLI response answers in (core, work-claim, ledger-publication, ledger-mutation, or bare result); dispatch namespace-first, then the domain's own version field (mutation contract section 2).
- **commit-per-mutation invariant** — on a provisioned ledger every mutation must be Git-committed before the next mutating command; `claim-verify` is the reconciliation verb.
- **frontmatter ownership boundary** — the three-way split of every frontmatter member into core-owned, consumer-editable through `patch`, and create-once; stated member by member in the mutation contract's ownership table, never discovered from a refusal.
- **input delivery** — the launch observation's optional report of what reached the core's standard input: `delivered`, `failed` (write errored), or `unread` (core never drained the pipe); an undelivered read is named, never reported as a timeout.
