# Fizzy adoption evaluation

Verified on 2026-09-06 against Fizzy commit [`159779317e61031ba8c38cbef7d6eff4a0a8440f`](https://github.com/basecamp/fizzy/tree/159779317e61031ba8c38cbef7d6eff4a0a8440f) and the current wowbagger worktree.

## Recommendation

Borrow presentation ideas, not Fizzy's lifecycle or infrastructure. The lowest-risk candidate is making existing item status, decision dates, age, and stuck evidence more visible in the report. This is a recommendation, not a measured usability improvement.

Do not implement Fizzy-style stalled detection or postponing-soon warnings as if the required data already exists. Wowbagger already has aging and stuck attention. Fizzy's activity model and automatic-postponement policy are different.

This report supersedes the initial chat assessment. No implementation or ledger changes were made as part of the research.

## Scope and evidence

The investigation read first-party source and API documentation. The re-verification pinned Fizzy reads to the commit above, inspected wowbagger source and schemas, and ran the real wowbagger aging function. It did not run Fizzy, verify webhook delivery, benchmark either product, or conduct a legal review.

Architecture descriptions below are documented claims unless explicitly identified as source-verified. Documentation is not evidence that every implementation path behaves as described.

## Source-verified lifecycle behavior

### Stalled cards require prior activity

Fizzy's [`Card::Stallable`](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/models/card/stallable.rb) uses a 14-day threshold. Its `stalled` query selects open, active cards with an existing activity spike, where both the spike timestamp and card update timestamp are at or before the cutoff. The instance predicate uses strict less-than comparisons and checks `open?`, so the query and predicate are not textually identical at the boundary or in their active-state filtering.

The [`activity spike detector`](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/models/card/activity_spike/detector.rb) requires an entropic card and one of:

- At least three comments from at least two participants within a window equal to 33% of the automatic-postponement period.
- An assigned card whose latest event is assignment within the previous minute.
- An open card whose latest event is reopening within the previous minute.

Therefore, "no activity for 14 days" is an incomplete description. A card without an activity spike does not qualify through this mechanism.

### Automatic postponement is not completion

[`Entropy`](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/models/entropy.rb) defines a default of 30 days and permitted values of 3, 7, 30, 90, 365, and 11 days. The unusual 11-day value is present in source. Board settings can override the account default.

[`Card::Entropic`](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/models/card/entropic.rb) selects active cards whose `last_active_at` is at or before the effective cutoff and postpones them as the account's system user. Its `postponing_soon` query covers inactivity from 75% of the period, inclusive, to 100%, exclusive.

[`Card::Postponable`](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/models/card/postponable.rb) sends the card back to triage, reopens it, clears its activity spike, creates a Not Now record, and records an event. Not Now is not Done. Avoid treating marketing language about automatic closing as proof of completion semantics.

### Triage is an inbox concept, not lifecycle parity

Fizzy's [`Card::Triageable`](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/models/card/triageable.rb) represents awaiting triage as an active card without a column. Triaging resumes the card and assigns a column on the same board.

Wowbagger creates items in `triage`; acceptance moves them to `backlog`. Both support deliberate intake, but their states and transitions are not interchangeable.

### Stamps contain status, date, and actor

Fizzy's [stamp view](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/views/cards/display/common/_stamp.html.erb) renders Done or Not Now, the corresponding date, and the responsible user's familiar name. It also distinguishes system-authored postponement in its CSS class.

Wowbagger can reuse the status/date presentation idea. Its decision records do not provide a structured actor, so a who/when stamp cannot be reproduced from decisions alone.

### Goldness is shared state

[`Card::Golden`](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/models/card/golden.rb) adds a shared card highlight and supports sorting golden cards first. [`Card::Goldness`](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/app/models/card/goldness.rb) belongs to an account and a card, not a user.

[Pins](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/docs/api/sections/pins.md) are per-user. [Boosts](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/docs/api/sections/reactions.md) are short card reactions associated with their author. Grouping all three as inherently per-user was incorrect. A shared highlight is technically possible without adding user accounts; its value beyond wowbagger priority remains unproven.

## Documented API and architecture

- The [API overview](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/docs/api/README.md) documents personal access tokens, magic-link authentication, ETag read caching through `If-None-Match`, and `Link` headers for pagination. Pagination is not universal: the pins endpoint explicitly returns up to 100 cards without pagination.
- The [webhook API](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/docs/api/sections/webhooks.md) documents action subscriptions, a signing-secret field, delivery history, and reactivation. Delivery history omits the signature header. This research did not verify delivery reliability or cryptographic enforcement.
- [Architecture notes](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/AGENTS.md) describe URL-prefix account scoping, UUIDv7 primary keys encoded as 25-character base36 strings, 16-way account-based MySQL full-text search sharding, SQLite FTS5, and streaming transfers supporting local and S3 storage. These were documentation-verified, not comprehensively traced or runtime-tested.
- The [style guide](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/STYLE.md) favors thin controllers calling domain models, CRUD resources such as closure, and shallow jobs with `_later`/`_now` naming. Ruby/Rails conventions are not a reason to change wowbagger's Node CLI architecture.

ULIDs and UUIDv7 serve similar time-oriented identifier purposes, but they are different formats. This research does not establish identical ordering or collision properties.

Wowbagger write CAS and Fizzy's documented read-cache ETags address different operations. The caching documentation does not establish Fizzy's complete write-concurrency behavior, so the initial claim that wowbagger is "stronger than ETags" is withdrawn.

## Fit against existing wowbagger behavior

The following local references identify the implementation inspected during re-verification:

- [`buildAgingMatrix`](../../src/report-evidence.js) crosses current status with elapsed time since `created`. It does not measure inactivity, despite the comment referring to stalled mid-flight work.
- [`buildStuck`](../../src/report-attention.js) selects in-progress items older than historical p85 accept-to-complete cycle time. It measures from the accept decision, falling back to creation. With no cycle-time threshold, it returns no stuck entries.
- [`ready`](../../src/ready.js) treats an item with `snoozed_until` after the report date as ineligible. Snooze expiration makes work eligible again; Fizzy's automatic postponement removes inactive work from its active set.
- The [`decision` schema](../../schemas/common.json) defines action, date, summary, rationale, and optional rollup. There is no structured decision actor to supply a stamp's "who".
- Core item dates and decision records do not provide Fizzy's `last_active_at` and activity-spike history. Deriving age is possible today; reproducing Fizzy's detector requires an explicit activity definition and authoritative data source.

### Runtime verification

Run from the repository root with Node 24:

```sh
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --input-type=module -e 'import { buildAgingMatrix } from "./src/report-evidence.js"; const item = {created:"2026-01-01",updated:"2026-09-06",status:"in-progress"}; console.log(JSON.stringify(buildAgingMatrix([item],"2026-09-06")));'
```

Observed output:

```json
{"statuses":["in-progress"],"rows":[{"label":"under 7d","counts":[0]},{"label":"7-30d","counts":[0]},{"label":"30-90d","counts":[0]},{"label":"over 90d","counts":[1]}]}
```

An item updated on the report date still appears in the oldest bucket. This proves that this function measures creation age, not inactivity. The probe does not test the whole report UI.

## Adoption decisions

These are research recommendations, not accepted ledger decisions or implementation commitments.

1. Consider a report presentation experiment using existing status, decision dates, age, and stuck evidence. Do not invent actor attribution.
2. Do not add another stalled badge before deciding what it means beyond existing aging/stuck attention. Fizzy-equivalent activity detection is not a data-free UI change.
3. Defer postponing-soon and automatic-postponement behavior. They require an explicit policy. Automation could use guarded core commands if authorized; it is not inherently incompatible with CAS, but no such policy was approved here.
4. Evaluate shared highlighting separately from user-specific pins and authored reactions. Do not reject goldness on the false premise that it requires per-user state.
5. Do not reserve Fizzy's `card_*` event names. Future integrations should use wowbagger's item vocabulary and define publication guarantees before event delivery.
6. Do not adopt Rails, database sharding, or hosted-service infrastructure for this Git-native ledger based on this survey.

## License boundary

The [O'Saasy license](https://github.com/basecamp/fizzy/blob/159779317e61031ba8c38cbef7d6eff4a0a8440f/LICENSE.md) permits use, copying, modification, merging, distribution, and sublicensing subject to notice preservation and a restriction on directly competing hosted, managed, SaaS, or cloud offerings whose primary value is the software's functionality.

It does not categorically prohibit code from residing in a repository that otherwise uses MIT. However, copied portions cannot be treated as unrestricted MIT code merely because of their destination. Independent implementation of selected behavior is the conservative recommendation. This is a reading of the license text, not legal clearance for a particular use. No Fizzy implementation code was copied into wowbagger.

## Corrections to the initial assessment

- Withdraw "implement stalled plus postponing-soon first" as a justified priority.
- Replace "aging already detects inactivity" with "aging measures creation age; stuck measures elapsed time against historical cycle time."
- Limit stamp adoption to available status/date evidence; decisions do not identify an actor.
- Separate shared goldness from per-user pins and authored boosts.
- Replace triage parity and identifier equivalence with narrower conceptual similarity.
- Withdraw the CAS-versus-ETag superiority comparison.
- Correct automatic closing to Not Now postponement, not completion.
- Qualify blanket pagination and architecture claims by their actual evidence.
- Replace the absolute license prohibition and blanket assurance about ideas with the license boundary above.
