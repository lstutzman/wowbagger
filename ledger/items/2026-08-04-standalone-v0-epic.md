---
schema_version: 2
id: wb_01KZ77NSW8PNA4S48NYT26AGMH
number: 9
title: "Deliver standalone Wowbagger v0"
kind: epic
status: done
created: 2026-08-04
updated: 2026-08-13
completed: 2026-08-13
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-04
    summary: "The remaining standalone v0 work is accepted for this repository."
    rationale: "The repository now uses its own ledger to coordinate the work described in the standalone v0 plan."
  - action: record
    date: 2026-08-05
    summary: "PropertyCompass2 backlog item 1419 describes this same epic and is superseded here."
    rationale: "The portable-tool extraction epic is tracked once, in this ledger, so wowbagger work has a single source."
  - action: record
    date: 2026-08-06
    summary: "This epic gates dogfooding: wowbagger cannot drive work from this repository until its children are complete."
    rationale: "Tracking this repository's own backlog here is the shallow sense of dogfooding and already works. Driving work from wowbagger needs claims implemented, concurrency proven, the consumer configuration and policy seams defined, packaging shipped, and at least one harness adapter delivered."
  - action: complete
    date: 2026-08-13
    summary: "Complete standalone Wowbagger v0."
    rationale: "All 21 direct children are done; the versioned core is released, claims are implemented, conformance is verified, and no standalone child remains open."
    rollup:
      - id: wb_01KZ77NSW876B92APQN8Q8NK6X
        status: done
      - id: wb_01KZ77NSW8825RKWA4AHJKN2YX
        status: done
      - id: wb_01KZ77NSW8A25Q593G7RTX7TAH
        status: done
      - id: wb_01KZ77NSW8CG8NMNZ726CFKWQE
        status: done
      - id: wb_01KZ77NSW8CXZRZ8JH2ADYZWH3
        status: done
      - id: wb_01KZ77NSW8P89118K6D6FSBFX2
        status: done
      - id: wb_01KZA1V3HN29SK5BS0P7RHS96R
        status: done
      - id: wb_01KZA5VGVR0W5ZJMV6G8K5F77P
        status: done
      - id: wb_01KZAZW75CWEG3R4BH4MZJAA7G
        status: done
      - id: wb_01KZBMBEZKPE7D15HKW9Q3GSZV
        status: done
      - id: wb_01KZBNMT2G2RTSEAGCH6PYFGWC
        status: done
      - id: wb_01KZBNMT2WWV2BWM2QEJX18RX2
        status: done
      - id: wb_01KZBNMT39DE0F95RV0C5K0EJQ
        status: done
      - id: wb_01KZE1GBG03JDGJQJG1H5896VZ
        status: done
      - id: wb_01KZE1GBG04T52TG5VJX4KV7N0
        status: done
      - id: wb_01KZE1GBG07PE2FEZQA32ZVQ36
        status: done
      - id: wb_01KZE1GBG0HA3MBWWZS6NQTW6E
        status: done
      - id: wb_01KZE1GBG0HARGNQVR1XCHQQKK
        status: done
      - id: wb_01KZE1GBG0QGB161XH2VFVBFXB
        status: done
      - id: wb_01KZE1GBG0WTJCBR30QKM2GXMK
        status: done
      - id: wb_01KZE1GBG0ZMPKHSYCGY4E5KXM
        status: done
---

This epic contains only standalone Wowbagger work. It intentionally excludes
PropertyCompass adoption and any other consumer migration.
