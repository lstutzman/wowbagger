# The optional policy-input contract

Version 1. This contract states how a consuming repository's policy may
steer or decorate core readiness without changing what the core computes.
It defines the seam; it never absorbs a consumer's vocabulary.

## 1. The seam

- **Mechanism belongs to the core**: ledger validity, lifecycle, readiness
  membership, the deterministic four-step ready order, and the lossless
  preservation of what it does not interpret.
- **Policy belongs to the consuming repository**: how priorities are chosen —
  weighted rubrics, bonus and partition ordering, confidence signals,
  tie-break conventions, mode workflows, per-type templates, scoring anchors
  naming that consumer's own features, its area and tier vocabularies, and
  its source globs.

A consumer's vocabulary never becomes core schema. The core neither knows
nor validates why a priority has the value it has.

## 2. The one core-steering input: priority

`priority` is the only policy input that changes core behaviour, exactly as
SPEC.md section 8 specifies: a non-negative integer supplied by a consumer
policy; lower values sort first; items with priority sort before items
without; the core reports the supplied value and never invents,
recalculates, or persists one on its own.

Policy writes priority through the guarded mutation surface, never by
hand-editing frontmatter:

- at creation, as `item.priority` on a create request; and
- afterwards, through `wowbagger patch` under the same revision
  compare-and-swap and per-ID lock as transition (mutation contract
  section 9).

Both paths validate the value's form at the request level. A policy engine
that recomputes priorities re-runs patch per changed item; the Git history
of those patches is the audit trail of the policy's decisions.

## 3. Decoration: extension members

Everything else a policy wants to attach rides the extension channel that
SPEC.md already defines: unknown top-level frontmatter members are permitted
when they do not change core semantics, are preserved losslessly through
every core mutation, are omitted from the normalized `core` view, and remain
recoverable from `source_base64`. A consumer may stamp rubric factors,
confidence signals, or area labels there. The core will never read them.

## 4. What policy must never do

- Change lifecycle validity or readiness membership. An item enters `ready`
  by the core's rules alone.
- Reorder, filter, or annotate the machine result: `ready --json` is
  byte-normative and belongs to the core. A downstream policy view that
  re-ranks or decorates the returned set is a separate consumer surface and
  must not present itself as core output.
- Write around the mutation surface. A policy engine edits priority through
  patch; hand-edits bypass validation, the per-ID lock, and compare-and-swap.

## 5. The version 1 adapter surface

Adapter describe results declare `optional_features.policy: false`: no
host-integrated policy feature exists in adapter contract version 1.
Advertising one is an adapter contract version change with its own
negotiation rules, following the same path recorded for the patch command
(mutation contract section 9, "Adapter advertisement").

## 6. Worked example

A consumer's rubric scores items 1, 5, 10, or 20 from factors only that
repository understands. The engine inspects each item, computes its score,
and issues one patch per item whose stored priority differs. The core sorts
the ready queue by those integers. The rubric's factors, anchors, and
vocabulary appear nowhere in this repository — which is the point.
