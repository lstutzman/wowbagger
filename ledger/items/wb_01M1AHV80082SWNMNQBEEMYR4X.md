---
schema_version: 2
id: wb_01M1AHV80082SWNMNQBEEMYR4X
number: 189
title: "Design GitHub canonical intake integration"
kind: task
priority: 1
status: backlog
created: 2026-08-31
updated: 2026-08-31
provenance:
  source: "github-issues-concurrency-evaluation"
  recorded_at: "2026-08-31T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-31
    summary: "Accept centralized GitHub intake integration for design and implementation."
    rationale: "A centralized GitHub issue identity can reduce duplicate intake across agents and machines, but only an idempotent or serialized writer closes the search-before-create race. Wowbagger remains the execution ledger rather than becoming a second intake authority."
---

Design and implement a GitHub Issues intake integration that prevents duplicate work requests while preserving Wowbagger's agent-native execution guarantees.

Problem:
- Multiple agents can independently create semantically duplicate work requests because local ledgers are not a centralized intake store.
- GitHub Issues provides repository-scoped identity, shared visibility, discussion, and cross-machine access, but search-before-create alone still has a race.

Initial direction:
- GitHub Issues is canonical for public intake, discussion, issue identity, assignees, labels, and project planning.
- Only accepted agent-executable work is projected into Wowbagger.
- Wowbagger remains authoritative for readiness, local ledger validation, CAS-guarded mutations, claims, fencing, publication, and reconciliation.
- Avoid bidirectional automatic synchronization and duplicate mutable sources of truth.

Acceptance criteria:
- Define the canonical GitHub issue identity and deterministic deduplication key.
- Define a serialized or idempotent intake writer; search-before-create without a race-safe writer is insufficient.
- Define the GitHub-to-Wowbagger projection and the reverse execution-outcome link.
- Define field ownership, edits, closure, deletion, retries, response loss, and drift handling.
- Preserve current Wowbagger scope and fail-closed guarantees; do not claim cross-machine coordination that the core does not provide.
- Verify the design against GitHub Issues/Projects APIs and current Wowbagger contract 5.


## Design

### Decision

Use a one-way hybrid. GitHub Issues is the canonical work-request registry; Wowbagger is the repository-local execution ledger. Only explicitly accepted agent-executable work is projected into Wowbagger. Do not create bidirectional automatic lifecycle synchronization.

### Identity and duplicate control

- Give every intake request a required idempotency key scoped to the GitHub repository. Retries with the same key must return the same GitHub issue number rather than create another issue.
- Store the key in a machine-readable HTML comment in the canonical issue body and retain the GitHub issue URL as the durable external identity.
- Treat semantic similarity as a review signal, not an unsafe automatic merge. A request with a different key may create a separate issue, but the intake writer should search and report likely duplicates before creation.
- A GitHub issue number is unique identity after creation; it is not semantic deduplication by itself.

### Central intake writer

- Route issue creation through one serialized, idempotent GitHub Action or GitHub App endpoint. Independent agents must not call issue creation directly when duplicate prevention is required.
- Serialize requests by repository and deduplication key. The writer performs check, create-or-reuse, and marker verification as one retryable workflow.
- A lost GitHub response is recovered by searching for the idempotency marker and repository identity; never blindly replay creation.
- The writer uses least-privilege GitHub permissions and returns the canonical issue URL, number, and request key.

### Field ownership

GitHub owns:
- issue title and intake description;
- issue state, labels, assignees, milestones, Projects fields, and discussion;
- public identity, duplicate candidates, and human acceptance.

Wowbagger owns:
- local ledger identity and bytes;
- readiness, lifecycle decisions, exact-byte revisions, claims, fencing, publication, and reconciliation;
- agent execution notes and links to commits or pull requests.

The projection must not overwrite GitHub's human-owned fields or infer that a closed GitHub issue proves a local execution result. Edits, closure, deletion, and drift produce an explicit reconciliation finding or review queue entry.

### GitHub-to-Wowbagger projection

- Project only issues that carry an explicit configured acceptance signal, such as a repository-specific label or Project field. Do not project every public issue.
- Add a declared ledger extension containing the canonical GitHub issue URL and request key. Do not overload Wowbagger's internal `id`, human-facing number, `related`, or core provenance semantics.
- Projection is idempotent on repository plus GitHub issue number. A second projection updates or reports the existing item; it never creates a second item.
- The projection runs in the target repository's execution workspace through the supported Wowbagger CLI, validates the ledger, and commits the item mutation using the normal ledger rules.

### Execution outcome

- Agents work from Wowbagger's deterministic ready queue and retain Wowbagger's inspect-before-write CAS, claims, fencing, and response-loss rules.
- On meaningful progress, commit, pull request, or terminal result, the integration may add a concise GitHub issue comment or link. That is a notification projection, not a second execution state machine.
- A pull request remains the authoritative code-change surface; the GitHub issue remains the public request surface; Wowbagger remains the agent execution surface.

### Failure and drift handling

- GitHub unavailable: fail intake or leave the request queued; never fall back to an uncoordinated local create.
- Projection failure: retain the GitHub issue and idempotency key, report projection-pending, and retry by key rather than creating another issue.
- GitHub edit or closure: record drift and require an explicit policy decision; do not silently mutate or delete the Wowbagger item.
- Wowbagger write refusal or stale revision: surface the core envelope and require re-inspection; do not retry a mutation blindly.
- Credentials and tokens stay in the GitHub Action/App secret store, never in ledger items or prompts.

### Non-goals

- Replacing Wowbagger's local ledger with GitHub Projects.
- Bidirectional automatic field or lifecycle mirroring.
- Claiming that GitHub provides Wowbagger's exact-byte CAS or core-level cross-machine fencing.
- Automatically deciding that two differently keyed requests are the same work.
- Adding GitHub network behavior to the harness-neutral Wowbagger core. Keep the integration in a GitHub-specific adapter, Action, or App boundary.

### Verification matrix

- Two concurrent submissions with one key produce one issue and identical canonical identity.
- A response loss after issue creation recovers the existing issue without replay.
- Two distinct keys remain distinct, with likely-duplicate warnings where applicable.
- Two projections of one issue produce one Wowbagger item.
- GitHub edit, closure, deletion, API refusal, and projection failure produce explicit findings.
- A local stale-revision refusal follows the normal Wowbagger recovery path.
- Permissions, secrets, rate limits, and retries are tested at the integration seam; core fixtures and independent oracles remain unchanged.
