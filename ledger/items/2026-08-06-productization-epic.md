---
schema_version: 2
id: wb_01KZBT435CG4HMTP0H6F3CTTNA
number: 21
title: "Deliver wowbagger as a consumable product"
kind: epic
status: done
created: 2026-08-06
updated: 2026-08-18
completed: 2026-08-18
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-06T15:12:29Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-06
    summary: "Accept into the productization epic."
    rationale: "Filed so the work is tracked in wowbagger's own ledger rather than in a session transcript."
  - action: defer
    date: 2026-08-13
    summary: "Defer the remaining productization epic."
    rationale: "The released product and consumer dogfood satisfy the first distribution milestone, but native Linux and Windows support evidence remains open and full PropertyCompass migration remains unauthorized."
  - action: undefer
    date: 2026-08-17
    summary: "Undefer."
    rationale: "Overtaken by events: PropertyCompass2 runs wowbagger in parallel with its legacy backlog on published alpha.5 - the dual-run that item 80 planned is live in the field, a fourteen-hundred-item provisioned ledger reconciles cleanly, and three days of field reports have driven eleven shipped fixes. The consumable-product epic is no longer hypothetical; its remaining children are the formal cutover plan."
  - action: complete
    date: 2026-08-18
    summary: "Wowbagger is a consumable product; the epic's children are all terminal."
    rationale: "Published on npm (latest and next), self-hosted on its own ledger, adopted by PropertyCompass2 in a verified dual-run, supported on darwin, linux, and win32 from native common-vector evidence, with a checkable release channel policy, a one-command cut, host-approval adapters, auto-commit, and a v4 core contract. The migration children were transferred to the consumer's own ledger and killed here; every remaining child is done."
    rollup:
      - id: wb_01KZ77NSW81FXZVAWQ8WT4KDCJ
        status: done
      - id: wb_01KZ77NSW8363H1V6QG1HZRG11
        status: done
      - id: wb_01KZ77NSW8R8C26CEJPJKHVPBT
        status: done
      - id: wb_01KZ77NSW8TWW2KWJANZ2TC837
        status: done
      - id: wb_01KZ77NSW8YFDJXSNTQ8FBB2F7
        status: done
      - id: wb_01KZ77NSW8ZP1289HFMN2ECNXD
        status: done
      - id: wb_01KZBT43RZSKMG8Z19RQQ43DDR
        status: done
      - id: wb_01KZBT447HVZ9798DXV1NTT515
        status: done
      - id: wb_01KZBT44T4EFEJH07G1AB07A1Y
        status: done
      - id: wb_01KZBT45ANXD8SX5X02F1KVKPJ
        status: done
      - id: wb_01KZHX3E001CSCENR21QMTDJFN
        status: done
      - id: wb_01KZHX3E00F59S35P71X9JGGB6
        status: done
      - id: wb_01KZHX3E00MX94XA5EG7J4TXWQ
        status: done
      - id: wb_01KZHX3E00RRK3X1WYTFCW70D4
        status: done
      - id: wb_01KZHX3E00VK34CWW9CVSN225F
        status: done
      - id: wb_01KZHX3E00XVRADSYMHC29A88Y
        status: done
      - id: wb_01KZHX3E00YP7ZXJAKKGENZYHH
        status: done
      - id: wb_01KZHX3E00Z81H2BT71FGP1CZY
        status: done
      - id: wb_01KZHX3E00ZH5SA7H0M3WNVP7N
        status: done
      - id: wb_01KZV3X9NW4SZF9MF7E2GQJ3VE
        status: done
      - id: wb_01KZV3X9QNRH2RJABFPKVW7X7V
        status: done
      - id: wb_01KZV3X9SFJ1MDNKN1VTJGK6EW
        status: killed
      - id: wb_01KZV3X9VAJA7T6E9FAMGKFSAR
        status: done
      - id: wb_01KZV3X9X2ZEVBMZN67FHS075G
        status: done
      - id: wb_01KZV3X9YRFSEVRB1G8M28921R
        status: done
      - id: wb_01KZVSW80HMW6RM39MX90P1TSH
        status: done
      - id: wb_01KZVSW82ZF94R3DZQQJ0NAYHZ
        status: done
      - id: wb_01KZVSW85FS738V9VM942M7NS6
        status: done
      - id: wb_01KZVSW885W9T05HSZK1GC0241
        status: done
      - id: wb_01KZVSW8AHGEJFVSX56ASRB2S5
        status: done
      - id: wb_01KZVSW8CW08GNPN38HPK3WF53
        status: done
      - id: wb_01KZVSW8F6VWX3CJGC4DMA38FP
        status: done
      - id: wb_01KZYS31006X1JKC2KDPSZSVAK
        status: killed
      - id: wb_01KZYS31008RT7QHS6CGKDVNTS
        status: killed
      - id: wb_01KZYS3100AB4C3ZCQ0DRFDG8Q
        status: done
      - id: wb_01KZYS3100KCTE3T0998YF55V8
        status: killed
      - id: wb_01KZYS3100MFHC5ZR6FGP8ZX6N
        status: killed
      - id: wb_01KZYS3100MFKB1GNH207DV9NE
        status: killed
      - id: wb_01KZYS3100NYPQ6AXGTBM9BFGT
        status: killed
      - id: wb_01KZYS3100VWKSWTF8NTXQD8P7
        status: killed
      - id: wb_01KZYS3100YCM93TCEMAS0CMBW
        status: killed
      - id: wb_01KZYS3100YCRMVR2M83T648TH
        status: killed
      - id: wb_01KZYS3100Z120XXBRAJCV150T
        status: killed
      - id: wb_01KZYS3100ZR9M1Y1YJ6W1RX4M
        status: killed
---

Make wowbagger consumable by repositories and harnesses other than this one.

The standalone v0 epic covers the core: contracts, the mutation runtime, claims,
and the conformance vectors. This epic covers everything required for someone
else to install wowbagger and drive real work with it — harness adapters, a
distribution channel, a release path, and first-party adoption in a live
consumer.

The two epics have a clean boundary. If it changes what the core does, it
belongs to standalone v0. If it changes how the core reaches a consumer, it
belongs here.

Definition of done for this epic: a named external consumer runs a released
wowbagger, installed through a real distribution channel, to coordinate its own
work — without copying files out of this repository.
