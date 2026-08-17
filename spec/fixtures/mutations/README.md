# Mutation compatibility vectors

These fictional vectors are normative black-box fixtures for
[the local mutation contract](../../../docs/mutation-contract.md). The runtime
executes every manifest and verifies its exact CLI output and complete
before/after filesystem snapshot.

## Manifest contract

Every case has a manifest JSON object:

~~~json
{
  "case": "inspect-success-lossless",
  "argv": ["inspect", "--ledger", "ledger", "--id", "wb_...", "--json"],
  "input": {
    "transport": "none",
    "path": null
  },
  "scenario": "normal",
  "expected": {
    "exit": 0,
    "stdout": {
      "json_file": "expected.json",
      "trailing_lf": true
    },
    "stderr": {
      "exact": ""
    },
    "files": {
      "before": [],
      "after": []
    }
  }
}
~~~

transport is none, file, or stdin. For file input, argv includes --input and
the same path. For stdin, argv includes --input and dash while path names the
bytes fed to standard input. Files with a .json suffix are valid unique-key
JSON. Intentionally invalid JSON input uses a .input suffix.

scenario is normal or a named deterministic filesystem fault seam documented
by that case. The runtime API does not expose a scenario flag.

stdout names the exact JSON object; the process adds one LF. stderr is exact.
before and after contain every Markdown item and recovery artifact in the
simulated ledger:

~~~json
{
  "path": "ledger/wb_....md",
  "source_file": "expected-item.md",
  "sha256": "sha256:<exact tracked-source digest>"
}
~~~

Entries sort by path. source_file is relative to the manifest. An absent source
file means path itself is the tracked source. Empty arrays mean an empty ledger
state. An unknown command outcome can still have an exact simulated after state:
the harness knows the injected filesystem result even when the command could
not verify it.

Rows normally omit type, which means file for compatibility with the original
vectors. A directory-tree collision uses explicit type values:

~~~json
[
  {
    "type": "directory",
    "path": "ledger/wb_....md"
  },
  {
    "type": "file",
    "path": "ledger/wb_....md/occupant.txt",
    "source_file": "ledger/wb_....md/occupant.txt",
    "sha256": "sha256:<exact digest>"
  }
]
~~~

A directory row has exactly type and path. Every represented directory below
the ledger root, empty or not, has one row; every contained regular file has a
file row and exact digest. Rows fully enumerate the tree in path order.
Symlinks and special files are never valid snapshot rows and remain rejected
by the ledger contract.

All Markdown sources use UTF-8 and LF. Hashes cover exact tracked bytes,
including delimiters and the final LF. source_base64 values decode to the exact
named source and hash to the declared revision.

## Coverage

| Area | Cases |
|---|---|
| Capabilities | precise local scope and unsupported claims |
| Inspect | lossless success, not found by id, not found by number, invalid ledger |
| Create transport | equivalent file and stdin requests |
| Create validation | invalid JSON, duplicate JSON key, unknown request member, unknown flag, missing member |
| Create identity/body | ID collision, unrelated-item and directory default-path collisions, empty body, LF-leading body |
| Create item layout | configured items directory absent, configured items directory occupied by a file |
| Candidate validation | create child under terminal epic, restore child under terminal epic |
| Create publication/recovery | unavailable atomic no-clobber, verified committed cleanup failure, unknown verification outcome |
| Transition concurrency | success, stale revision, held lock, exhausted lock-closure retries, date rollback |
| Transition lifecycle | task terminalization, archive restore, epic completion |
| Multi-item refusal | dependent cleanup, dependent disposition, child disposition, terminal referrer, combined blockers |
| Patch relations | re-scoped dependent, dangling depends_on reference |
| Patch body | mirror-sync body swap with untouched frontmatter, refused null body |
| Patch title | mirror-sync title correction with untouched extension nodes, refused empty title |
| Patch extensions | declared identifier correction with untouched anchored extension nodes, refused undeclared member |
| Mutation states | unchanged, committed, and unknown |

Claims, adapters, PropertyCompass data, Git transport, and multi-item
implementation are deliberately absent.
