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

The current core is read-only. Until a reviewed mutation command exists, make
ledger edits as ordinary, reviewable Git changes and do not represent them as
atomic compare-and-set operations or work claims. Keep standalone Wowbagger
work separate from any consumer-adoption decision.
