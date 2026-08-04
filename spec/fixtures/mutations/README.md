# Proposed mutation contract vectors

These vectors are fictional, normative design fixtures for
[the proposed mutation contract](../../../docs/mutation-contract.md). They are
not executable tests and do not claim that the current read-only Wowbagger CLI
has mutation commands.

Each directory is independent. When a vector contains a ledger directory, that
directory is the complete configured ledger for the invocation. Invocation
files describe the command inputs relative to the vector directory; create and
transition request files are the contents passed through --input.

Create starts with an empty valid ledger and publishes expected-item.md under
its generated default filename. Transition-success starts with before.md copied
to the target's default filename in an otherwise empty valid ledger, then
replaces it with expected-item.md. Stale-revision-conflict starts with its
ledger directory; previous-item.md is the earlier inspected source whose hash
appears in the request. Lock-held starts with its ledger directory plus
held-lock.json installed as the documented per-ID lock file. The remaining
ledger directories are ready to invoke as written.

The fixture-only generation-context file is not a public create request. It
pins a clock and entropy value so the expected generated ULID and item bytes
are reproducible in a future black-box test harness.

All item sources are UTF-8 with LF line endings. Every expected revision is
SHA-256 over the exact raw bytes of the named item file, including frontmatter
delimiters and the final line-feed. Hashes must use the lowercase
sha256:<hex> form.

| Vector | Demonstrates |
|---|---|
| capabilities | Exact advertised local backend scope, including unsupported work claims. |
| inspect | Parsed item/body response and exact-byte revision for a fixed source file. |
| create | JSON input, fixture-only deterministic ID generation, default filename, expected item, and committed result. |
| transition-success | A triage-to-backlog single-item CAS transition with preserved body and unknown field. |
| stale-revision-conflict | A stale inspected revision refusing to overwrite current bytes. |
| lock-held | A structured existing lock preventing a transition without automatic stale-lock handling. |
| multi-item-required | A done transition refusing required dependent cleanup rather than making two independent writes. |

The fixtures deliberately do not exercise claims, adapters, PropertyCompass
data, a database, Git transport, or a multi-item backend.
