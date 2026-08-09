# Migrate a ledger to schema version 2

Use `scripts/migrate-schema-2.js` once for a non-empty schema-version-1
ledger. The command is a maintenance tool, not a core mutation command. It is
dry-run-only unless you add `--apply`.

The migration changes only the parsed top-level `schema_version` scalar in
each item. It preserves the remaining frontmatter, comments, line endings,
extensions, and Markdown body. It prints one change line per item and a summary
count.

## Before the maintenance window

1. Upgrade every reader, adapter, script, and worktree that will access the
   ledger so it understands schema version 2.
2. Stop all writers and editors that can change the target working copy.
3. Take a complete backup outside the ledger. Keep the current Git state as a
   second recovery source.
4. Do not remove an old item lock only because its timestamp is old. Resolve it
   through the audited manual recovery process in
   [ADR 0003](adr/0003-local-mutation-and-cas.md).

The tool refuses a held item lock under `<ledger>/.wowbagger-locks/`. This
check is evidence that a cooperative writer is active. It is not protection
against an editor, Git operation, old script, or other writer that ignores the
lock protocol. The stopped-writer maintenance window remains mandatory.

## Run the dry run

From the Wowbagger checkout, replace `path/to/ledger` with the target ledger:

```sh
TMPDIR=/tmp node scripts/migrate-schema-2.js --ledger path/to/ledger
```

The command first loads the complete ledger and validates it under schema
version 1. It then builds and validates the complete schema-version-2 candidate
in memory. A successful dry run prints `WOULD CHANGE` for every item and ends
with a zero-write summary. It does not create, rename, or modify an item.

Review every reported path and the count before you continue.

## Apply the migration

After the backup exists and the window is quiesced, run:

```sh
TMPDIR=/tmp node scripts/migrate-schema-2.js --ledger path/to/ledger --apply
```

Each `CHANGED` line is written only after that item has been replaced. The tool
reloads the complete on-disk ledger after the last write. It reports success
only when that result validates as a uniform schema-version-2 ledger.

Run an independent validation before other processes resume:

```sh
TMPDIR=/tmp node bin/wowbagger.js validate --ledger path/to/ledger --json
```

## Dependency history

The migration does not change `depends_on` or `related`.

Schema version 1 required a done item to have an empty `depends_on` list. If a
done item still has a dependency, the schema-1 preflight refuses the complete
ledger. The tool does not repair that state.

Earlier schema-1 completion may already have removed a satisfied prerequisite
from `depends_on` and appended it to `related`. No field records that the
relation was once a prerequisite. The migration cannot recover that typed
history and must not infer it. Those entries remain in `related`.

## Failure and recovery

The refusals are deliberate:

- `invalid-schema-1` means the complete input did not validate. Repair it as
  schema version 1 before another dry run.
- `mixed-schema-versions` means a prior attempt stopped after some item writes.
  Restore the complete ledger from the pre-migration backup or Git. Do not
  finish the remaining stamps by hand.
- `already-schema-2` means this tool will not run again. Validate schema version
  2. Restore the backup or Git if that validation fails.
- `empty-ledger` means there is no schema stamp to change. An empty ledger still
  defaults to schema version 1.
- `lock-held` means the window is not quiesced. Stop the writer and use audited
  lock recovery before another dry run.
- `lock-state-unknown` means the lock directory could not be inspected. Fix the
  read failure before another dry run.
- `partial-write-failed` reports the next item and the exact completed count.
  Restore the complete ledger before another attempt.
- `post-validation-failed` means all reported writes are untrusted as a set.
  Restore the complete ledger before another attempt.

This migration writes several files and is not atomically visible as one
operation. Each item replacement is atomic, but the ledger can be mixed between
replacements. That is why this tool is outside the
[local mutation contract](mutation-contract.md) and must run only in a
quiesced maintenance window.

There is no transaction journal and no roll-forward recovery command. The
clear per-item output shows how far the process got. The complete backup and
Git are the recovery story.
