# Proposed mutation compatibility vectors

These fictional vectors are normative design fixtures for
[the proposed mutation contract](../../../docs/mutation-contract.md). They are
not executable tests and do not claim that the current read-only CLI implements
mutation.

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

All Markdown sources use UTF-8 and LF. Hashes cover exact tracked bytes,
including delimiters and the final LF. source_base64 values decode to the exact
named source and hash to the declared revision.

## Coverage

| Area | Cases |
|---|---|
| Capabilities | precise local scope and unsupported claims |
| Inspect | lossless success, not found, invalid ledger |
| Create transport | equivalent file and stdin requests |
| Create validation | invalid JSON, duplicate JSON key, unknown request member, unknown flag, missing member |
| Create identity/body | ID collision, unrelated default-path collision, empty body, LF-leading body |
| Candidate validation | create child under terminal epic, restore child under terminal epic |
| Create publication/recovery | unavailable atomic no-clobber, verified committed cleanup failure, unknown verification outcome |
| Transition concurrency | success, stale revision, held lock, exhausted lock-closure retries, date rollback |
| Transition lifecycle | task terminalization, archive restore, epic completion |
| Multi-item refusal | dependent cleanup, dependent disposition, child disposition, terminal referrer, combined blockers |
| Mutation states | unchanged, committed, and unknown |

Claims, adapters, PropertyCompass data, Git transport, and multi-item
implementation are deliberately absent.
