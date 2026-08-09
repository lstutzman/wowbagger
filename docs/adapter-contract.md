# Harness-neutral adapter contract

Status: version 1, accepted for adapter design. No adapter executable is
implemented by this document.

This is the public contract for a thin adapter between a coding-agent harness
and the existing Wowbagger core CLI. It supplements [SPEC.md](../SPEC.md),
[the mutation contract](mutation-contract.md), and
[ADR 0005](adr/0005-harness-neutral-adapter-contract.md). The core contracts
remain authoritative for ledger meaning, command JSON, exit codes, and mutation
limits.

The words MUST, MUST NOT, SHOULD, and MAY are normative.

## 1. Scope and terms

An **adapter** is a small integration that translates a configured harness
request into a documented Wowbagger core command. It is not a second core.

| Term | Meaning |
|---|---|
| Core | The standalone `wowbagger` CLI and its published JSON contracts. |
| Harness | A host that may provide a workspace, filesystem, command runner, instruction inputs, and model interaction. |
| Model transport | A protocol that sends model requests and responses. It can be OpenAI-compatible without being a usable coding harness. |
| Consumer | The repository owner or authorized operator who configures the adapter and grants authority. |
| Workspace | A consumer-approved repository root known to a harness under an opaque identifier. |
| Instruction input | Bounded text that the harness explicitly supplies for a session. It is not discovered by guessing a filename. |

Version 1 covers only these core commands: `validate`, `ready`, `capabilities`,
`inspect`, `create`, and `transition`. An adapter MUST use their documented
`--json` forms. It MUST NOT create an alternate interpretation of lifecycle,
readiness, revisions, locks, error codes, or mutation state.

The core contract version and this adapter-contract version are different
numbers. `contract_version` in core JSON is defined by the core. This document
uses `adapter_contract_version`.

Every adapter manifest, describe result, invocation, result, instruction input,
and handoff is one UTF-8 JSON object with no duplicate member names at any
depth. A receiver rejects an invalid or duplicate-member object rather than
choosing a last member.

## 2. Boundary

The adapter boundary is deliberately narrow.

| Concern | Core | Adapter | Harness or consumer |
|---|---|---|---|
| Ledger validation and readiness | Owns | Forwards | May request |
| Local mutation scope and revisions | Owns | Probes and forwards | May approve a request |
| Command process and byte streams | Produces | Launches and preserves | Supplies a safe runner |
| Workspace selection and path guard | Rejects unsafe ledger entries | Verifies its own input boundary | Configures approved roots |
| Instruction discovery | Does not do it | Carries declared inputs | Supplies or configures inputs |
| Model API | Does not do it | May describe it | Provides it when applicable |
| Session state | Does not retain it | Carries an explicit handoff only | Stores or delivers it deliberately |
| Commit, push, install, or setup | Does not do it | Disabled by default | Requires separate approval |

An OpenAI-compatible API is model transport only. It MUST NOT cause an adapter
to report filesystem access, no-follow path handling, command execution,
standard-stream forwarding, instruction discovery, or mutation authority. A
host that has transport but lacks the required tools is API-only and cannot
invoke the core.

## 3. Version and capability negotiation

An adapter package has a static manifest and a dynamic `describe` operation.
Discovery is passive: parsing a manifest MUST NOT install software, run a
command, start a daemon, or contact a network service.

The consumer selects an installed package or host registration. No adapter may
scan a repository for a vendor file, infer a host from a model name, or select
a package merely because an API endpoint is reachable.

Before an invocation, a client MUST:

1. use fixed `bootstrap_wire_version` 1 to call `describe`;
2. select adapter contract version 1 when both peers include it, or refuse;
3. obtain `describe` and reject a required capability that is missing or
   `false`;
4. invoke core `capabilities --json` before assuming a core mutation,
   coordination, or durability capability; and
5. treat an unknown field, missing field, unsupported version, or failed probe
   as unavailable.

The describe request is the exact object `bootstrap_wire_version`,
`supported_adapter_contract_versions`, and `request_id`, with no other members.
The request ID uses the safe opaque-ID syntax. Request version arrays are
nonempty, unique, sorted-ascending arrays of positive safe integers. The
version 1 manifest array is exactly `[1]`, and the successful dynamic result
selects exactly `1`; advertising a shared future version does not activate an
undocumented schema or handler. A future version requires a separately
registered manifest, request, result, and invoke-schema handler.
Malformed request, manifest, and dynamic objects are refused as
`invalid-describe-request`, `invalid-adapter-manifest`, and
`invalid-describe-result`, respectively; validation never depends on host
array methods or property access before the containing schema has passed.

Bootstrap is deliberately non-circular. Wire version 1 is fixed independently
of the adapter versions being negotiated. The client sends its supported
adapter versions; `describe` selects one or refuses. An implementation MUST
compare the static ID, adapter version, platform declaration, and required core
contract version with the dynamic result, then compare the required core
contract version with the actual `capabilities --json` probe. Any mismatch or
unsupported platform is a refusal before the requested core command launches.
For each invocation, it MUST determine the active runtime platform and launch
only when the matching static and dynamic platform value is exactly
`supported`. `unsupported`, `unverified`, and an unlisted active platform are
`adapter-platform-mismatch` refusals with `platform`, `status`, and
`required: "supported"` details before core launch.

The adapter MUST preserve the core `capabilities` result as core output. The
probe is the exact successful version 1 core `capabilities --json` envelope:
its root, backend, operations (`inspect`, `create`, `transition`, and
`work_claim`), durability, and limits objects accept no missing or additional
members and every fixed value must match the published core contract. A
missing, extra, malformed, wrong-command, or wrong-contract probe is refused.
The adapter's complete ordered version 1 command list must match the probed
core contract. `optional_features.claims` is derived only from
`operations.work_claim.supported`; `optional_features.policy` remains false
because core version 1 advertises no policy feature. Static or dynamic claims
cannot elevate either value. The adapter MUST NOT turn a local mutation
capability into cross-worktree, cross-clone, or
work-claim support.

### 3.1 Static package manifest

An installed package MAY expose a UTF-8 JSON file named
`wowbagger-adapter.json`. A host registration may carry the same object without
a file. This packaging name is not an instruction-discovery convention.

The manifest has these required members:

```json
{
  "adapter_manifest_version": 1,
  "adapter_id": "org.example.wowbagger.adapter",
  "adapter_version": "1.0.0",
  "adapter_contract_versions": [1],
  "bootstrap_wire_version": 1,
  "required_core_contract_version": 1,
  "entrypoints": {
    "describe": {
      "kind": "command",
      "executable": "bin/wowbagger-adapter",
      "fixed_args": ["describe"]
    },
    "invoke": {
      "kind": "command",
      "executable": "bin/wowbagger-adapter",
      "fixed_args": ["invoke"]
    }
  },
  "platforms": {
    "darwin": "unverified",
    "linux": "unverified",
    "win32": "unverified"
  }
}
```

`adapter_id` is a stable reverse-domain-style identifier. `adapter_version` is
the package version. Version arrays are unique and sorted ascending. An
entrypoint is either a consumer-registered `host-tool` or the exact command
schema shown above. `executable` is a nonempty forward-slash relative path
anchored at the installed package root. Absolute, drive, UNC, device, volume,
backslash, control-character, empty-segment, `.`, and `..` forms are invalid on
every platform. The package root, every parent component, and the final regular
file are resolved no-follow and their stable identities are rechecked
immediately before launch. `fixed_args` is an array of UTF-8 strings without
NUL or control characters; arguments are passed directly and never through a
shell. Consumer
registration may replace the entire entrypoint, but a request may replace
neither field nor append arguments. The runner launches it directly without a
shell. Host-tool registrations have equivalent consumer-granted authority and
MUST identify the registered tool by a fixed name.

The manifest root and each entrypoint object are exact. Every displayed root
member is required, unknown members are refused, and a `host-tool` entrypoint
contains exactly `kind: "host-tool"` and a nonempty string `name`.

After manifest validation, a command entrypoint is joined to the approved
package root only after its relative syntax passes. A missing, link, junction,
reparse point, special file, escaping component, or identity replacement is a
refusal before the adapter process launches.

Platform values are `supported`, `unsupported`, or `unverified`. `supported`
requires native evidence from the common adapter vectors. A manifest MUST use
`unverified` until it has that evidence.

### 3.2 Dynamic describe result

`describe` returns exactly one UTF-8 JSON object. Its successful envelope has
these members and no undocumented root members:

```json
{
  "ok": true,
  "bootstrap_wire_version": 1,
  "selected_adapter_contract_version": 1,
  "adapter_id": "org.example.wowbagger.adapter",
  "adapter_version": "1.0.0",
  "core": {
    "required_core_contract_version": 1,
    "commands": ["capabilities", "create", "inspect", "ready", "transition", "validate"]
  },
  "host": {
    "command_execution": {
      "supported": true,
      "arguments_array": true,
      "shell": false,
      "stdio": true,
      "process_tree_containment": true,
      "orphan_detection": true,
      "timeout_enforcement": true,
      "stdout_limit": true,
      "stderr_limit": true
    },
    "filesystem": {
      "workspace_selection": "guarded-relative",
      "no_follow_resolution": true,
      "stable_identity": true,
      "component_walk": true
    },
    "model_transport": {
      "available": true,
      "protocol": "openai-compatible"
    },
    "instruction_input": {
      "mode": "host-provided",
      "max_sources": 8,
      "max_bytes": 65536
    },
    "handoff": {
      "supported": true,
      "persistence": "explicit-only"
    },
    "trusted_approval": {
      "supported": true,
      "sources": ["consumer"]
    },
    "integration_mechanisms": {
      "hooks": false,
      "slash_commands": false,
      "mcp": false,
      "daemon": false
    }
  },
  "optional_features": {
    "claims": false,
    "policy": false
  },
  "limits": {
    "max_request_bytes": 65536,
    "max_context_bytes": 65536,
    "max_stdout_bytes": 1048576,
    "max_stderr_bytes": 65536,
    "max_timeout_ms": 30000
  },
  "platforms": {
    "darwin": "unverified",
    "linux": "unverified",
    "win32": "unverified"
  }
}
```

The example does not assert that such a host exists. It shows the required
separation of capabilities. `model_transport` is descriptive. It does not
change `command_execution` or `filesystem`.

The root and every nested object shown above are exact, except that
`host.trusted_approval` MAY be absent to declare mutations unavailable. Every
other displayed member is required and no additional member is accepted.
Command arrays are unique,
ordered subsets of the version 1 core command list; capability flags are
booleans; enumerated strings and bounded integers use the domains described
below. A missing member, extra member, wrong type, unknown enumeration, or
invalid bound is `invalid-describe-result`.

When present, version 1 trusted approval has exactly one authority label:
`trusted_approval.sources` MUST equal `["consumer"]`. Model, agent, system,
tool, harness, and additional source labels are invalid describe results; they
cannot become trusted through configuration. `trusted_approval.supported` MUST
be `true` for `create` or `transition`. A false or absent member makes those
commands unavailable before an approval is validated or redeemed. Read-only
commands remain available.

A non-null `handoff_carrier` requires `host.handoff.supported: true` before
the carrier is parsed. A supported value of `false` is a
`capability-unavailable` refusal with `missing: ["handoff"]`; an absent or
malformed handoff capability is `invalid-describe-result`. Neither case can
launch the core.

`command_execution.supported` is true only when the adapter can launch the
configured core executable with an argument array, without a shell, and capture
both byte streams. `filesystem.workspace_selection` is `guarded-relative` only
when the adapter can apply section 4. `instruction_input.mode` is `none`,
`host-provided`, or `configured-relative-paths`. `handoff.persistence` is
always `explicit-only` in version 1.

Capability fields obey these cross-field invariants; a contradictory describe
result is `invalid-describe-result`.

| Mode | Required dependent values |
| --- | --- |
| `command_execution.supported: true` | `arguments_array`, `stdio`, `process_tree_containment`, `orphan_detection`, `timeout_enforcement`, `stdout_limit`, and `stderr_limit` are `true`; `shell` is `false`; every advertised byte/time limit is a positive safe integer. |
| `command_execution.supported: false` | Every dependent execution Boolean is `false`, including `shell`; `core.commands` is empty, so the adapter does not advertise invoke capability. |
| `filesystem.workspace_selection: "guarded-relative"` | `no_follow_resolution`, `stable_identity`, and `component_walk` are all `true`. |
| `filesystem.workspace_selection: "none"` | `no_follow_resolution`, `stable_identity`, and `component_walk` are all `false`. |
| `instruction_input.mode: "none"` | `max_sources` and `max_bytes` are zero. |
| Other instruction-input modes | `max_sources` and `max_bytes` are positive safe integers. |

Byte limits are finite nonnegative safe integers; zero permits no content.
`max_timeout_ms` is a finite positive safe integer. Byte limits apply to raw
bytes before base64 expansion. An adapter MAY advertise smaller limits than
the example. It MUST NOT imply an unbounded context, output, or execution time.

`optional_features.claims` and `optional_features.policy` default to `false`.
They may become true only after both a future versioned core contract and the
adapter advertise the same feature. The current local core reports work claims
unsupported. A mutation lock remains a short local mutation lock, not a claim.

### 3.3 Bootstrap command wire

Command entrypoints use the same bootstrap transport for `describe` and
`invoke`:

- The runner writes exactly one strict UTF-8 JSON object to stdin and closes
  stdin. Duplicate members, trailing bytes, and invalid UTF-8 are refused.
- The entrypoint writes exactly one strict JSON object followed by one LF to
  stdout. No prefix, progress record, or second object is allowed. Diagnostic
  text is bounded and may use stderr; it is never parsed as a result.
- Exit 0 means a complete bootstrap response was written, including an
  `ok:false` response. A nonzero exit, signal, timeout, malformed response, or
  incomplete bounded stream is transport failure.
- The installed package root is the entrypoint working directory. The
  invocation's separately guarded `cwd` applies only to the core child. The
  adapter environment is a consumer-configured allowlist; inherited secrets,
  Git variables, shell startup, and request-supplied environment entries are
  excluded.
- The runner applies finite stdin, stdout, stderr, and wall-clock limits. It
  starts the adapter and core in a containable process-tree unit and, on limit,
  timeout, or cancellation, terminates that whole unit and verifies that no
  descendant remains. A runner unable to provide or verify containment MUST
  advertise command execution unavailable.

The describe request contains only `bootstrap_wire_version`,
`supported_adapter_contract_versions`, and an opaque `request_id`. The invoke
request uses the selected version. A describe result advertises
`trusted_approval`; absence means mutations are unavailable. Static and dynamic
adapter ID, adapter version, selected contract, complete three-platform map,
and `core.required_core_contract_version` MUST match exactly. The independently
launched core probe must then match that required core version. Error
precedence is describe-request schema, static-manifest schema, bootstrap wire
compatibility, common-version selection, dynamic-result schema, static/dynamic
identity and version, selected contract, required core, platform map, core
probe, capabilities, path/input validation, approval, then launch.

## 4. Workspace and path selection

The model never supplies an absolute workspace root. A consumer preconfigures
an opaque `workspace_id` that maps to one approved root. The adapter accepts
only logical paths relative to that root.

A logical path is `.` or one or more forward-slash-separated segments. It MUST
NOT be absolute, empty, contain a backslash, NUL, drive prefix, volume prefix,
`.` segment, or `..` segment. Windows drive-relative forms such as `C:repo`,
drive-rooted forms using either separator, UNC forms using either separator,
device namespaces such as `\\?\C:` and `\\.\COM1`, and `Volume{...}` roots are all
invalid on every host platform. The same logical syntax is used on macOS,
Linux, and Windows; the adapter rejects platform prefixes before converting a
logical path to a host path.

For a core request with a workspace, the adapter MUST:

1. resolve `workspace_id` to a consumer-approved real directory without
   following a link or reparse point at the root;
2. resolve `cwd` and `ledger` from that root with a no-follow check on every
   existing path component, including Windows reparse points;
3. reject a missing, symbolic-link, junction, reparse-point, special, or
   escaping component before launching the core; and
4. re-check stable platform file identities immediately before launch, refuse
   a replacement, and launch the core with the resolved `cwd` plus an absolute
   ledger argument anchored at the workspace root.

`cwd` never changes the base for `ledger`. For example, `cwd: "nested"` and
`ledger: "ledger"` select `<root>/nested` as the child working directory and
`<root>/ledger` as the ledger; `<root>/nested/ledger` is a decoy and MUST NOT
be selected. Root, cwd, ledger, and every component are directories with
no-follow `lstat` identity snapshots. The adapter checks the root and each
cumulative component (for example `nested`, then `nested/deep`) before and
immediately before launch. A component replacement between validation and
launch is `path-replaced`, not permission to retry through the new component.

Every before/after snapshot is the exact object `{ "kind": ..., "identity":
... }`. `kind` is the required portable kind for that position (`directory`
for package/workspace roots and parents, `regular-file` for a command
executable). `identity` is either a nonempty control-free opaque stable token,
an exact POSIX `{ "dev": ..., "ino": ... }` object, or an exact Windows
`{ "volume_id": ..., "file_id": ... }` object. Explicit identity members are
nonempty control-free strings or nonnegative safe integers. Missing, malformed,
or extra snapshot members on either side are `path-rejected`; two valid
same-kind snapshots with unequal identities are `path-replaced`.

The core separately rejects a symbolic-link ledger root and symbolic-link
entries below it. The adapter boundary does not claim to eliminate privileged
filesystem races. It prevents a caller from selecting an arbitrary path or
silently traversing a link before the core gets its own fail-closed check.

An adapter that cannot make this no-follow determination MUST report
`no_follow_resolution: false` and MUST NOT accept local workspace or ledger
selection. An API-only host therefore cannot claim a local core invocation.

## 5. Invocation

An adapter accepts a structured request. It MUST NOT accept raw shell source,
an arbitrary executable, an arbitrary CLI argument list, or an arbitrary input
file path. It constructs the documented core argument vector itself.

```json
{
  "adapter_contract_version": 1,
  "request_id": "ready-forwarding-0001",
  "workspace": {
    "workspace_id": "example-workspace",
    "cwd": "."
  },
  "core_request": {
    "command": "ready",
    "ledger": "ledger",
    "as_of": "2030-01-15"
  },
  "instruction_input": {
    "required": false,
    "instruction_input_version": 1,
    "sources": []
  },
  "handoff_carrier": null,
  "limits": {
    "context_bytes": 4096,
    "stdout_bytes": 65536,
    "stderr_bytes": 4096,
    "timeout_ms": 30000
  }
}
```

`request_id` is an opaque ASCII identifier of 1 through 128 characters using
letters, digits, period, underscore, and hyphen. The adapter returns it
unchanged. Requested byte limits MUST be finite nonnegative safe integers no
greater than the advertised values. `timeout_ms` is required, positive, and no
greater than `max_timeout_ms`; it bounds the complete contained adapter/core
process observation.

The runner applies its finite local `max_request_bytes` ceiling before parsing
the raw invocation. After describe succeeds, the same raw bytes MUST also be
at most `described.limits.max_request_bytes`; that advertised cap is
authoritative for the invocation. A describe result that advertises a request
cap above the local ceiling is inconsistent and is refused as
`invalid-describe-result`. The adapter never enlarges either cap.

`workspace` is required for every command except `capabilities`. `cwd` defaults
to `.` when omitted. `ledger` is required for every workspace command and uses
the logical path rules in section 4.

The tagged `core_request` members are exact:

| Command | Required members | Core argument vector |
|---|---|---|
| `capabilities` | `command` | `capabilities --json` |
| `validate` | `command`, `ledger` | `validate --ledger <ledger> --json` |
| `ready` | `command`, `ledger`, `as_of` | `ready --ledger <ledger> --as-of <date> --json` |
| `inspect` | `command`, `ledger`, `id` | `inspect --ledger <ledger> --id <id> --json` |
| `create` | `command`, `ledger`, `input_base64` | `create --ledger <ledger> --input - --json` |
| `transition` | `command`, `ledger`, `input_base64` | `transition --ledger <ledger> --input - --json` |

`input_base64` is RFC 4648 base64 without line breaks. Its decoded bytes are
the exact UTF-8 JSON request sent to standard input. The adapter MUST check the
decoded byte limit before launching the core. It MUST use `--input -`; it MUST
NOT write a caller-selected request file.

`as_of`, `id`, and decoded mutation requests retain their core validation
rules. The adapter does not normalize dates, IDs, JSON whitespace, YAML, or
request bytes.

The version 1 request root always carries `instruction_input` and
`handoff_carrier`: an optional instruction set is represented by the exact
empty carrier `{ "instruction_input_version": 1, "required": false,
"sources": [] }`, and no handoff is represented by `null`. This keeps the root
schema exact instead of making validation depend on omitted fields. The
carriers are validated as sections 7 and 8 specify before core launch. A
required instruction set that is
missing or invalid produces a named diagnostic refusal; it cannot be silently
replaced by guessed files or prior-session memory.

### 5.1 Consumer authority

`create` and `transition` require an explicit consumer approval event for that
invocation and `trusted_approval.supported: true` in describe. The event may be
represented to the adapter by a trusted host mechanism, but a model-supplied
Boolean is not approval. If approval is absent, the adapter returns
`consumer-approval-required` without launching the core. If trusted approval
is false or absent, it returns `capability-unavailable` with
`missing: ["trusted-approval"]` before validating or redeeming any approval.

Read operations do not grant mutation authority. No version 1 request grants
authority to commit, push, modify remote configuration, install dependencies,
start a setup script, edit a harness configuration, or bypass repository
instructions or safety gates. These actions are outside this interface.

Trusted command-entrypoint approval uses this exact object:

```json
{
  "approval_version": 1,
  "source": "consumer",
  "nonce": "single-use-opaque-value",
  "issued_at": "2030-01-15T12:00:00Z",
  "expires_at": "2030-01-15T12:05:00Z",
  "invocation_digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
```

The digest covers this exact binding object; no member is optional and no
extra member is accepted:

```json
{
  "request_id": "mutation-approval-0002",
  "adapter": {
    "id": "org.example.wowbagger.adapter",
    "version": "1.0.0",
    "contract_version": 1
  },
  "core": {
    "executable_identity": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "contract_version": 1,
    "argv": ["transition", "--ledger", "/approved/workspace/ledger", "--input", "-", "--json"],
    "input_base64": "e30K"
  },
  "workspace": {
    "id": "example-workspace",
    "root": "/approved/workspace",
    "cwd": "/approved/workspace",
    "ledger": "/approved/workspace/ledger"
  },
  "limits": {
    "context_bytes": 4096,
    "stdout_bytes": 65536,
    "stderr_bytes": 4096,
    "timeout_ms": 30000
  },
  "instruction_set_digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "handoff_digest": null
}
```

The consumer authority signs or delivers this record through the configured
trusted channel; the model and instruction inputs are never trusted sources.
The configured trusted-source set MUST be exactly `{consumer}`. A missing
consumer or any additional model, agent, system, tool, harness, or other label
is `approval-source-untrusted`, even when the approval object itself says
`source: "consumer"`.
The adapter canonicalizes a binding as UTF-8 JSON with object keys sorted
lexicographically, no insignificant whitespace, arrays retained in order, and
ordinary JSON scalar encoding. The SHA-256 binding includes request ID;
workspace ID, root, cwd, and absolute ledger; exact core executable identity,
contract version, argv, and stdin bytes; adapter ID/version/selected contract;
all byte/time limits; instruction-set digest; and handoff digest. Any change
requires new approval. Approval and binding objects use exact-member schemas.
Version must be 1; nonce is 16–128 ASCII letters, digits, periods, underscores,
or hyphens; digests use lowercase `sha256:` plus 64 hex characters. Issued,
expiry, and current time use canonical whole-second RFC 3339 UTC; invalid time,
`issued_at >= expires_at`, or current time before issue fails closed. The nonce
is redeemed atomically once, expires at `now >= expires_at`, and is scoped to
this consumer/adapter instance. Replay, expiry, unknown source, and binding
mismatch refuse before launch. More
restrictive repository, consumer, or harness policy wins; approval never
overrides an instruction or safety refusal.

## 6. Result, streams, and exit status

When the core process starts and both streams fit the requested bounds, the
adapter returns exactly one JSON result envelope:

```json
{
  "ok": true,
  "adapter_contract_version": 1,
  "request_id": "ready-forwarding-0001",
  "result": {
    "core_command": "ready",
    "core_exit_code": 0,
    "stdout": {
      "encoding": "base64",
      "data": "eyJhc19vZiI6IjIwMzAtMDEtMTUiLCJ2YWxpZCI6dHJ1ZSwicmVhZHkiOltdfQo=",
      "sha256": "sha256:73b7879d83e6047beee2720b38f4e882b98dc351452112d5a9e5f85cac7e8eda",
      "byte_length": 47
    },
    "stderr": {
      "encoding": "base64",
      "data": "",
      "sha256": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "byte_length": 0
    }
  }
}
```

The result envelope's `ok` means that the adapter completed transport. It does
not mean that the core command succeeded. `core_exit_code` MUST equal the
actual child-process exit code, including a nonzero validation, request,
conflict, capability, or operation result. The base64 values decode to the
exact child stream bytes. Their SHA-256 values cover those decoded bytes.

An adapter MUST NOT trim, reformat, parse-and-reserialize, prefix, suffix, or
replace a core stream. It MAY provide a separately named parsed JSON view only
when it proves that it is derived from the complete decoded standard output;
that view is never the authoritative core result.

For every `--json` core command, decoded standard output is complete only when
it is one compact JSON object followed by exactly one LF. Whitespace outside
JSON strings, a missing final LF, or a CR or second LF before that final LF is
a core protocol failure. The adapter still preserves those exact captured bytes
in its process observation; it does not normalize them into a valid result.

For `inspect`, the decoded core standard output is complete only when its
exact command and contract version match, exactly one of `result` or `error`
is present, and its exit is consistent with that success or documented error.
On success, `result` contains exactly `item`. The item has the exact documented
lossless core shape: canonical ID, safe ledger-relative Markdown path, source
encoding and media type, canonical source bytes, matching source digest, and a
normalized core/body view that agrees with those decoded UTF-8 source bytes.
The adapter validates core version 1 field domains and rejects an extra,
missing, source-inconsistent, or semantically invalid item as a protocol
failure.
For `create` and `transition`, the same checks also require the exact mutation
state: success is `state: "committed"` with `result` and exit 0; an error has
`error` and its documented `unchanged`, `committed`, or `unknown` state and
exit. A declared `unknown` state is an adapter
`mutation-outcome-unknown`, not a completed mutation result. Any malformed,
incomplete, mismatched-command, mismatched-version, mismatched-state,
result/error, or exit-inconsistent mutation envelope is likewise
`mutation-outcome-unknown` with section 6 recovery.

Before forwarding a complete core envelope, the adapter also binds every
request-derived response member to the exact canonical request it launched.
`ready` success repeats the requested `as_of`; an `inspect` item or
`item-not-found` detail repeats the requested ID. Every mutation response with
a target ID repeats the caller's ID. A transition `revision-conflict` repeats
the requested expected revision and has an actual revision that differs from
it. A committed-recovery transition reports a new revision rather than the
expected pre-transition revision. Create success uses the requested default
path and the exact canonical candidate source bytes (including permitted
extension data), whose digest and normalized view already have to match the
returned item. A committed create recovery reports the SHA-256 digest of those
same exact candidate bytes for that caller ID and default path; a merely
well-formed digest is not enough. Transition success repeats the target status,
date, and required decision evidence. Error operation and lock-owner
identifiers retain their documented meanings and are validated against their
target item rather than being treated as opaque strings. A response that is
valid in isolation but cannot be bound to this request is a protocol failure
(and therefore an unknown mutation outcome for a mutation). In particular, a
core `invalid-request` mutation response is acceptable only when the supplied
mutation bytes did not form a canonical valid request. The adapter retains the
exact decoded request bytes for this response check, including malformed JSON
and duplicate-key observations; it does not promote an invalid request into a
valid mutation merely to correlate its error.

The adapter also rejects self-contradictory or nondeterministic mutation
details. An `atomic-scope-required` envelope has a nonempty, unique blocker
array sorted by code, item ID, then field, and it retains its possibly empty
but ordered precondition issue array. Invalid-request issues sort by path,
code, then message. Transition issues sort by code, field, then related-ID
sequence, and each related-ID sequence is unique and ascending. Recovery
artifacts are unique by path, sorted by path then kind, contain at most 16 entries,
and use the documented truncation rule. These checks preserve the core's
deterministic response semantics instead of accepting an equivalent-looking
but impossible envelope. Blocker and precondition-issue fields also retain the
fixed meanings of their codes: dependency codes use `depends_on`, child codes
use `parent`, date checks use `date`, and an invalid edge uses `to_status`.

The adapter parses every returned item source, checks its source digest,
lossless body, and normalized view, then applies the authoritative ledger
validator to the returned item. It supplies only valid synthetic relation
targets needed to evaluate invariants that a one-item response can establish;
any validator error attributed to the returned item is a protocol failure.
This covers the version 1 kind and status domains, epic `in-progress`
prohibition, ID-created-date agreement, timestamp ordering, terminal dates and
decisions, dependency and relation rules, and terminal epic rollup evidence.
The core remains responsible for complete-ledger facts that cannot be observed
from one returned item. A valid validation result has an empty error array.
Every invalid-ledger, candidate-invalid, or ledger-invalid response has a
nonempty validation-error array in the deterministic `path`, `field`, `code`,
then `message` order.

`ready` has two exact complete core forms. A valid ready result has exactly
`as_of`, `valid: true`, and `ready`, with exit 0. A documented invalid-ledger
result has exactly `valid: false` and a nonempty deterministically ordered
`errors` array, with exit 1. The adapter forwards the latter's nonzero exit and
exact bytes. Other hybrid, extra, empty-error, or inconsistent ready shapes
are `core-protocol-error`.

If a wrapper also offers a stream passthrough mode, it MUST write the exact core
standard output and standard error and use the same exit code. It MUST NOT add
the outer envelope to either core stream.

When the adapter cannot provide a complete core observation, it returns this
error envelope:

```json
{
  "ok": false,
  "adapter_contract_version": 1,
  "request_id": "ready-forwarding-0001",
  "error": {
    "code": "capability-unavailable",
    "message": "The configured host cannot invoke the Wowbagger core.",
    "details": {
      "missing": ["command-execution"]
    }
  }
}
```

The following operation classes are exhaustive and disjoint. Their sorted
union is the complete public version 1 registry. Every code is emitted by the
reference model and exercised as an expected vector result; adding or removing
a code requires changing the classes, registry, executable evidence, and drift
test together.

<!-- adapter-error-code-classes:start -->
```json
{
  "approval": [
    "approval-binding-mismatch",
    "approval-expired",
    "approval-not-yet-valid",
    "approval-replayed",
    "approval-source-untrusted",
    "consumer-approval-required",
    "invalid-approval",
    "invalid-approval-binding",
    "invalid-approval-time",
    "invalid-approval-time-order"
  ],
  "handoff": [
    "handoff-digest-mismatch",
    "handoff-instruction-set-mismatch",
    "handoff-item-mismatch",
    "handoff-limit-exceeded",
    "handoff-resume-binding-mismatch",
    "handoff-stale-item-revision",
    "handoff-workspace-mismatch",
    "invalid-handoff-bytes",
    "invalid-handoff-carrier",
    "invalid-handoff-json",
    "invalid-handoff-object",
    "invalid-handoff-resume-request"
  ],
  "instruction": [
    "duplicate-instruction-source-id",
    "instruction-byte-limit-exceeded",
    "instruction-source-limit-exceeded",
    "invalid-instruction-input",
    "invalid-instruction-source",
    "required-instruction-input-missing"
  ],
  "invocation": [
    "capability-unavailable",
    "context-limit-exceeded",
    "core-launch-failed",
    "core-observation-incomplete",
    "core-protocol-error",
    "core-signaled",
    "core-timeout",
    "invalid-invocation",
    "mutation-outcome-unknown",
    "output-limit-exceeded",
    "path-rejected",
    "path-replaced",
    "timeout-limit-exceeded"
  ],
  "negotiation": [
    "adapter-contract-selection-mismatch",
    "adapter-identity-mismatch",
    "adapter-platform-mismatch",
    "adapter-version-mismatch",
    "core-contract-version-mismatch",
    "invalid-adapter-manifest",
    "invalid-describe-request",
    "invalid-describe-result",
    "required-core-contract-version-mismatch",
    "unsupported-adapter-contract-version",
    "unsupported-bootstrap-wire-version"
  ]
}
```
<!-- adapter-error-code-classes:end -->

The flattened registry is:

<!-- adapter-error-codes:start -->
```text
adapter-contract-selection-mismatch
adapter-identity-mismatch
adapter-platform-mismatch
adapter-version-mismatch
approval-binding-mismatch
approval-expired
approval-not-yet-valid
approval-replayed
approval-source-untrusted
capability-unavailable
consumer-approval-required
context-limit-exceeded
core-contract-version-mismatch
core-launch-failed
core-observation-incomplete
core-protocol-error
core-signaled
core-timeout
duplicate-instruction-source-id
handoff-digest-mismatch
handoff-instruction-set-mismatch
handoff-item-mismatch
handoff-limit-exceeded
handoff-resume-binding-mismatch
handoff-stale-item-revision
handoff-workspace-mismatch
instruction-byte-limit-exceeded
instruction-source-limit-exceeded
invalid-adapter-manifest
invalid-approval
invalid-approval-binding
invalid-approval-time
invalid-approval-time-order
invalid-describe-request
invalid-describe-result
invalid-handoff-bytes
invalid-handoff-carrier
invalid-handoff-json
invalid-handoff-object
invalid-handoff-resume-request
invalid-instruction-input
invalid-instruction-source
invalid-invocation
mutation-outcome-unknown
output-limit-exceeded
path-rejected
path-replaced
required-core-contract-version-mismatch
required-instruction-input-missing
timeout-limit-exceeded
unsupported-adapter-contract-version
unsupported-bootstrap-wire-version
```
<!-- adapter-error-codes:end -->

Error details are bounded JSON. They MUST NOT expose
credentials, environment values, raw instruction contents, arbitrary absolute
paths, or platform exception text.

If a stream exceeds its requested bound, the adapter MUST stop or contain the
core process according to the host's safe runner rule. It returns
`output-limit-exceeded`; it MUST NOT present a partial core JSON result as
valid. It may report only bounded byte counts and stream names needed for
recovery. It must not silently enlarge a limit.

The runner supplies the exact process observation object `started`,
`process_tree_contained`, `orphaned`, `exit_code`, `signal` (a portable runner
label, not necessarily a POSIX signal), `timed_out`, `stdout_complete`,
`stderr_complete`, `stdout_base64`, and `stderr_base64`. Booleans, canonical
base64 streams, a null or nonnegative integer exit code, and a null or
nonempty control-free signal label are type-checked before classification; no
unknown members are accepted. A normally terminated child tree has an integer
exit code and no timeout or signal. A null exit without another incomplete
observation condition, a missing or malformed exit, or an integer exit paired
with timeout/signal is an incomplete observation. The outer process summary
derives, rather than accepts, `core_envelope_present` and
`core_envelope_valid` from the captured stdout bytes. A result is complete only
after the child tree has ended, both streams ended within bounds, no descendant
remains, and stdout contains the strict complete core envelope expected for
that command.

Launch classification is tri-state for mutations. A normal
`core-launch-failed` is allowed only for a complete, internally consistent
observation that proves `started: false`: no exit, signal, timeout, output,
orphan, or missing stream/containment evidence. A missing, malformed, or
contradicted `started` member leaves launch unknown, as does every other
ambiguous observation, and therefore produces `mutation-outcome-unknown`.
Read-only commands retain their ordinary transport errors and never acquire a
mutation outcome.

The adapter independently decodes each captured base64 stream and compares its
decoded byte length with the invocation's requested stdout or stderr limit.
An over-limit capture is `output-limit-exceeded` for a read and
`mutation-outcome-unknown` for a mutation, even when the runner reports the
stream complete. Runner completion flags cannot enlarge a byte bound.

For read-only commands precedence is: a proven not-started observation →
`core-launch-failed`; timeout → `core-timeout`; signal → `core-signaled`;
containment/orphan doubt or malformed observation →
`core-observation-incomplete`; stream truncation → `output-limit-exceeded`;
then missing or invalid complete envelope → `core-protocol-error`. Exit code is
recorded but never overrides an earlier transport failure. No partial core JSON
is valid.

Mutation commands are stricter: unless the observation proves that launch did
not occur, any timeout or signal produces `mutation-outcome-unknown` even when
both buffered streams and a nominal success envelope appear complete.
Containment uncertainty, incomplete stdout, incomplete stderr, a missing or
invalid `started` observation, or a missing/invalid complete core envelope also
produces `mutation-outcome-unknown`—even if exit was zero or captured bytes
look like a success. The adapter MUST NOT label it failed, roll it back, or
retry it.

Every create request therefore carries a caller-generated item ID. Recovery is
bounded and explicit: validate the ledger, inspect that known ID, and retry
only after `item-not-found` plus review/recovery of any audited publication
artifact. For transition, validate, inspect the known ID, and compare the
caller-known expected revision with the current revision and state; never
retry until that observation is reviewed. This distinction prevents both a
hidden committed mutation and an orphaned duplicate mutation.

## 7. Instruction inputs

The contract does not assume `CLAUDE.md`, `AGENTS.md`, any other filename,
slash command, hook, MCP server, daemon, or model vendor. A harness may supply
instruction inputs through this bounded envelope:

```json
{
  "instruction_input_version": 1,
  "required": true,
  "sources": [
    {
      "source_id": "repository-rules",
      "origin": "repository",
      "content_encoding": "base64",
      "content_base64": "VXNlIHRoZSBhcHByb3ZlZCBsZWRnZXIgb25seS4K",
      "sha256": "sha256:f42a9b7fa06a5825cc6c5faf5a5ed2b217ecf65672aee9e40572feddb36e2578",
      "byte_length": 30,
      "logical_path": "config/repository-rules.txt"
    }
  ]
}
```

Sources are ordered by the harness. Each array member must first be an exact
JSON object; null, primitive, array, missing-member, and extra-member values
are deterministic `invalid-instruction-source` refusals and never cause
property-access exceptions. `origin` is `repository`, `consumer`,
`harness`, `user`, or `adapter`. A source MAY have an optional logical relative
path for diagnostics, but the path has no built-in semantic meaning. A host
with `configured-relative-paths` can read only consumer-configured paths using
section 4. It MUST NOT fall back to a guessed name.

The carrier has exactly `instruction_input_version`, `required`, and `sources`.
Version is 1 and `required` is Boolean. Each source has exactly `source_id`,
`origin`, `content_encoding`, `content_base64`, `sha256`, and `byte_length`,
plus optional `logical_path`. Source IDs are unique safe ASCII identifiers;
origin uses the stated enum; encoding is `base64`; base64 is canonical; and
logical paths use section 4 syntax. Unknown members or versions are refused.

The adapter verifies base64, byte length, SHA-256, source count, and total byte
limit before presenting input to a model. Instruction contents are data, not
executable configuration. Missing inputs do not waive repository instructions,
consumer policy, safety gates, or approval requirements.

The adapter preserves supplied order and exposes a bounded diagnostic record
for each source: zero-based ordinal, `source_id`, origin, numeric precedence,
optional logical source path, byte length, and digest. Content is never echoed
in diagnostics. The
`instruction_set_digest` is SHA-256 over canonical ordered records containing
source ID, origin, byte length, and content digest; changing order changes the
set digest. Source precedence is consumer, repository, harness, user, then
adapter defaults, but a lower-precedence source cannot weaken a higher one and
the stricter safety rule wins. A configured required source that is absent,
invalid, over limit, or unreadable produces
`required-instruction-input-missing` or `invalid-instruction-source` before
model or core invocation.

Instruction refusals are `invalid-instruction-input`,
`required-instruction-input-missing`, `invalid-instruction-source`,
`duplicate-instruction-source-id`, `instruction-source-limit-exceeded`, and
`instruction-byte-limit-exceeded`.

## 8. Explicit handoff and resume

An adapter MAY carry an explicit handoff carrier. It has no hidden retrieval
mechanism and no authority by itself. The decoded handoff bytes contain this
exact strict JSON object:

```json
{
  "handoff_version": 1,
  "workspace_id": "example-workspace",
  "instruction_set_digest": "sha256:f42a9b7fa06a5825cc6c5faf5a5ed2b217ecf65672aee9e40572feddb36e2578",
  "item": {
    "id": "wb_01KDWPVNG00000000000000000",
    "revision": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

The invoke envelope carries this exact carrier schema:

```json
{
  "handoff_carrier_version": 1,
  "workspace_id": "example-workspace",
  "content_encoding": "base64",
  "content_base64": "eyJoYW5kb2ZmX3ZlcnNpb24iOjEsIndvcmtzcGFjZV9pZCI6ImV4YW1wbGUtd29ya3NwYWNlIiwiaW5zdHJ1Y3Rpb25fc2V0X2RpZ2VzdCI6InNoYTI1NjpmNDJhOWI3ZmEwNmE1ODI1Y2M2YzVmYWY1YTVlZDJiMjE3ZWNmNjU2NzJhZWU5ZTQwNTcyZmVkZGIzNmUyNTc4IiwiaXRlbSI6eyJpZCI6IndiXzAxS0RXUFZORzAwMDAwMDAwMDAwMDAwMDAwIiwicmV2aXNpb24iOiJzaGEyNTY6MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCJ9fQo=",
  "byte_length": 287,
  "sha256": "sha256:31a1d0490913a7117eb4ff50937ff265af41d385fc80e17593ba0a75550b260b",
  "resume_request": {
    "item_id": "wb_01KDWPVNG00000000000000000",
    "expected_revision": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "instruction_set_digest": "sha256:f42a9b7fa06a5825cc6c5faf5a5ed2b217ecf65672aee9e40572feddb36e2578"
  }
}
```

No carrier, resume-request, handoff-object, or item member may be missing or
extra. The adapter validates version 1, `base64`, canonical base64 bytes,
length, digest, strict UTF-8 JSON including duplicate-member rejection,
workspace binding, item ID/revision, and instruction-set digest. Item IDs in
both `resume_request.item_id` and decoded `item.id` MUST match the canonical
Wowbagger grammar `^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$`; a merely generic safe
identifier is invalid. Carrier,
decoded handoff, configured workspace, resume request, current inspected item,
and current instruction set must agree. Handoff text cannot grant approval or
enlarge limits.

Instruction decoded bytes plus decoded handoff bytes share the invocation's
single `context_bytes` bound; their individual bounds do not create extra
capacity. The handoff MUST be explicitly stored or
delivered by the consumer or harness. The adapter MUST NOT create a hidden
database, infer a prior session, or silently reload memory.

Handoff refusals are `handoff-digest-mismatch`, `invalid-handoff-carrier`,
`invalid-handoff-bytes`, `handoff-limit-exceeded`, `invalid-handoff-json`, `invalid-handoff-object`,
`invalid-handoff-resume-request`, `handoff-workspace-mismatch`,
`handoff-resume-binding-mismatch`, `handoff-instruction-set-mismatch`,
`handoff-item-mismatch`, and `handoff-stale-item-revision`.

On resume, an adapter re-negotiates capabilities and validates the ledger. If a
handoff names an item or revision, it re-inspects and compares current bytes
before a mutation. It MUST NOT auto-transition an item, renew a claim, commit,
push, or treat a stale revision as permission to overwrite.

The current instruction-set digest and item revision MUST exactly match the
resume request. A mismatch is a bounded refusal naming only the mismatched
member and digests or revisions. The adapter retains no unlisted memory
between invocations and does not search for handoff records.

## 9. Installation and portability

The manifest lets a consumer register a package in a native harness, a local
tool registry, or a generic command runner. The packaging contract does not
require a network service, MCP, a daemon, Gastown, Beads, a particular package
manager, a shell, or a model API.

Portable adapters use UTF-8, JSON, argument arrays, bounded standard streams,
and logical forward-slash paths. They do not assume POSIX shell syntax,
Unix-only signals, hard links, a global install location, or a particular
working-directory convention. The core itself reports filesystem-dependent
mutation capabilities per operation.

macOS, Linux, and Windows claims are separate. An adapter marks a platform
`supported` only after the conformance suite runs successfully on that native
platform with its real path and command runner. A current absence of a platform
implementation is `unverified`, not `unsupported` and not a compatibility
promise.

## 10. Conformance

The synthetic vectors in [spec/fixtures/adapters](../spec/fixtures/adapters/)
are normative. They contain no consumer source, policy, people, or ledger data.
Each manifest is strict JSON and hashes every test artifact. The fixture test
checks JSON duplicate-member rejection, hashes, safe relative paths, and the
applicable target list. `direct-core` appears only on equivalence cases; path,
authority, instructions, handoff, process containment, and adapter negotiation
are adapter concerns and do not pretend that the core implements them.

The direct core is the baseline. A future adapter does not pass by emitting an
equivalent-looking object; it passes by preserving the baseline core exit code
and exact standard-output and standard-error bytes for each compatible case.

`node spec/run-adapter-vectors.js` is the executable reference-model runner.
Forwarding and negative invocation cases enter through the strict raw-byte
reference `invoke` function. The real core run is a baseline comparison inside
that invoke path, never a substitute for the adapter boundary. The invoke
function enforces `max_request_bytes` before JSON parsing or request-member
access, then applies exact request/carrier schemas, version negotiation, the
exact core capability probe, host capabilities, guarded paths, approval,
bounded process observation, and complete outer result/refusal envelopes. The
runner also evaluates deterministic protocol,
path, authority, limit, mutation-recovery, and version models for adapter-only
assertions. The standalone runner itself rejects duplicate-member JSON, verifies
every artifact hash, fails on an unknown mode or assertion type, rejects any
hashed artifact that no assertion consumes, and reports a reference
function/evidence label for every executed assertion ID.
It validates `adapter_vector_version` as exactly `1` before it evaluates an
artifact. The test suite fails unless those IDs exactly equal every manifest
assertion; it re-hashes wrong expectation artifacts and proves that every
expected result is semantically rejected rather than merely read. Its status is
`reference-pass`. It does not run a real Claude Code, Codex, Kimi, or generic
adapter, so its implementation statuses remain `unverified`.
`node spec/run-adapter-implementation.js` accepts the same fixture directory,
evaluates real transactions through the shipped Claude Code entrypoint and
emits the same result shape with an evidence platform. Its current native
Darwin run is `fail`: 180 of 183 assertions and 13 of 15 cases pass. A failing
candidate run earns no platform support claim, so Claude Code, Codex, Kimi, and
generic adapter implementations remain `unverified`.

The supported manifest assertion types are `core-baseline`, `capability`,
`instruction-order`, `path-refusal`, `output-bound`, `approval-gate`,
`resume-plan`, `platform-status`, `process-outcome`, `path-race`,
`path-syntax`, `snapshot-identity`, `entrypoint-path`, `invoke-version`,
`core-probe`, `negotiation`, `context-validation`, and `approval-schema`.
The runner fails closed on any other type.

| Requirement | Direct core baseline | Claude Code adapter | Codex adapter | Kimi adapter | Generic OpenAI-compatible harness adapter |
|---|---|---|---|---|---|
| Core JSON, standard streams, and exit | Reference-pass | Unverified | Unverified | Unverified | Unverified |
| Capability negotiation | Reference-pass for core probe | Unverified | Unverified | Unverified | Unverified |
| Instruction input | Not a core concern | Unverified | Unverified | Unverified | Unverified |
| Safe workspace and ledger selection | Core ledger checks only | Unverified | Unverified | Unverified | Unverified |
| Bounded context and output | Reference bytes only | Unverified | Unverified | Unverified | Unverified |
| Mutation authority and recovery | Core mutation contract only | Unverified | Unverified | Unverified | Unverified |
| API-only transport refusal | Not applicable | Unverified | Unverified | Unverified | Unverified |
| Resume and handoff | Not a core concern | Unverified | Unverified | Unverified | Unverified |

The API-only negative vector is intentionally different: it must refuse core
invocation because model transport alone is not a coding harness. A generic
OpenAI-compatible *harness* that advertises the required filesystem and command
capabilities must meet the same forwarding vectors as the other adapters.

## 11. Non-goals

This contract does not:

- adopt Wowbagger in PropertyCompass or any other consumer repository;
- add vendor-specific lifecycle logic to the core;
- require an MCP server, daemon, hook, slash command, Gastown, or Beads;
- define work claims, policy ranking, or hidden persistent agent memory;
- grant automatic Git commit, push, setup, installation, or configuration
  authority; or
- implement a Claude Code, Codex, Kimi, or generic adapter.
