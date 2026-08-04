# Contributing to Wowbagger

## Repository work ledger

The repository's real work ledger is [`ledger/`](ledger/). It contains only
Wowbagger ledger-item Markdown files; keep explanatory documentation outside
that directory.

Before submitting a change that adds or edits an item, validate the whole
ledger and inspect its current ready work, replacing `YYYY-MM-DD` with the
current UTC date:

```sh
./bin/wowbagger.js validate --ledger ledger --json
./bin/wowbagger.js ready --ledger ledger --as-of YYYY-MM-DD --json
```

Use `inspect`, `create`, and `transition` only within their documented local
scope. A transition that requires changing a dependent or child must remain a
reviewable multi-file Git change until a future backend advertises a suitable
atomic scope. Do not represent a short mutation lock as a work claim. Keep
standalone Wowbagger work separate from any consumer-adoption decision.
