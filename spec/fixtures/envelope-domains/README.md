# Envelope domains

The normative pin for the one envelope rule stated in
[docs/mutation-contract.md](../../../docs/mutation-contract.md) section 2.

`manifest.json` records, for every response class the CLI emits:

- `domain` — the response domain the class belongs to;
- `command` — the `command` member, or `null` for a bare result;
- `exit`, `state`, `error_code`;
- `root_members` — the exact root members, in emission order.

It also records the domain table itself: each domain's `namespace` value,
`contract_version`, the version a consumer negotiates for that domain, the
commands that answer in it, and its permitted root-member shapes.

`test/envelope-dispatch.test.js` drives the real CLI through every class in the
manifest and compares both directions. An implementation whose envelope drifts
from the manifest fails. A manifest that pins a class the CLI no longer emits,
drops a class the CLI does emit, or stops covering an advertised command also
fails. The test transcribes the dispatch rule from the contract and imports
nothing from `src/`, so it reads the wire the way a generic JSON consumer does.

Two shapes in the manifest are sanctioned exceptions rather than envelopes:
`validate` and `ready` emit bare results. The contract says why they stay bare.
