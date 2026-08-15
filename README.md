# app-air-dcs

**An airline departure control system that records the inputs to weight-and-balance
and baggage-reconciliation decisions and makes none of them.** Twenty files
extracted verbatim from `etzhayyim/root`, carrying three separate
implementations. **Only one of the three is in the deployed bundle**, and every
hostname any of them talks to is **NXDOMAIN**.

The code is not broken. The tests pass and eight deliberate mutations were all
caught. But two of the ten tests do not measure what their names say — including
the one guarding the passport numbers — and the function called
`computeLoadSheet` performs no arithmetic of any kind.

Read this file before `MIGRATION-TODO.md`, which describes a remediation plan for
a deployment that does not exist.

## What is true now

Measured 2026-08-16 against `03d6248`. Every row is reproducible from
[`docs/operator-quickstart.md`](docs/operator-quickstart.md).

| What this repo asserts | What is true now |
|---|---|
| `wrangler.jsonc` serves `air-dcs.etzhayyim.com/*` and `a1rd3cs0.etzhayyim.com/*` | Both are **NXDOMAIN** on 1.1.1.1, 8.8.8.8 and 9.9.9.9; `curl` returns `000`. The zone is healthy — `etzhayyim.com` apex answers `200` from Cloudflare NS — so these are missing labels, not an outage. |
| `src/app.ts` proxies to `dispatcher.etzhayyim.com` | **NXDOMAIN.** |
| `svelte/…/xrpc/[...path]/+server.ts` proxies to `mcp.etzhayyim.com` | **NXDOMAIN.** Both upstreams are gone, so no request path in this repo can complete even if it were deployed. |
| `kotodama.jsonld` declares the actor `did:web:air-dcs.etzhayyim.com` | Unresolvable — `did:web` needs `https://air-dcs.etzhayyim.com/.well-known/did.json` and the host does not resolve. The **parent** `did:web:etzhayyim.com` does resolve (200, Ed25519 key, PDS at `pds.aozora.app`). |
| `kotodama.jsonld` `@context: https://etzhayyim.com/ns/kotodama/v1` | **404.** The document cannot be expanded; it is JSON-LD in shape only. |
| `NOTICE`: "Charter Compliance Rider v3.1 (see `CHARTER-RIDER.md`)" | That file is **not in this repository** (it is upstream, 30,600 bytes). The same repo's `MIGRATION-TODO.md` says to audit against Rider **v2.0**. Two versions, neither carried. |
| `MIGRATION-TODO.md`: seed awaiting a Charter §2(a) codemod | The scan recorded in that same file found **none** of the patterns it was written to remove. The blocker was never the codemod. |
| `svelte/src/routes/+page.svelte` reports `routeCount: 0`, no routes, no vars | `wrangler.jsonc` in the same repo declares **2 routes and 8 vars**. The landing page is a generator artifact that never read the config next to it, and still names its own path as `60-apps/etzhayyim-project-air-dcs/…` — the location it was extracted out of. |
| `package.json` `typecheck: tsc --noEmit` | There is no root `tsconfig.json` and no input files. It exits **1 with zero `error TS` lines** — it failed without examining anything. |
| Upstream `etzhayyim/root@main:60-apps/etzhayyim-project-air-dcs` | Gone. `60-apps` on `main` now holds exactly one entry, `etzhayyim-project-organism`. |
| **`00-contracts/bpmn/com/etzhayyim/air-dcs/`** | **Still there, all 8 processes, on upstream `main` today.** Unlike the app, the contract survived — and it is the most useful thing in this document. |

## Three implementations, one deployed

`wrangler.jsonc` sets `main` to `svelte/.svelte-kit/cloudflare/_worker.js`. That is
the whole deploy. Building it and searching the **entire** resulting closure (41
files — `cloudflare/` plus `cloudflare-tmp/manifest.js` and `output/server/**`,
both of which `_worker.js` imports across directory boundaries) finds:

| Implementation | Size | In the deployed bundle? |
|---|---|---|
| `svelte/` — SvelteKit BFF, forwards XRPC to the MCP router | 2.4 kB endpoint | **Yes.** All four probe symbols present. |
| `src/app.ts` — edge dispatcher, 8 methods, `/health` + `/_app/meta` | 76 lines | **No.** All seven probe symbols absent. |
| `kotoba/src/**` — the actual domain model (plaintext/E2E split) | 17 exports | **No.** All six probe symbols absent. |

`kotoba/` is where the real work is — flight-level operational anchors in the
clear (`flightDeparture`, `loadSheet`, `turnaround`, `baggageReconciliation`) and
every per-person record (check-in, baggage, APIS manifest) sealed via
`encryptedWrite`. It is a library no deployed code imports.

## The contract survived, and it is not a vocabulary gap

`src/app.ts` advertises a BPMN path in its `/health` payload:
`etzhayyim-root/00-contracts/bpmn/com/etzhayyim/air-dcs`. **That path is live on
upstream `main`** — eight hand-written Zeebe processes, one per method. Lining
them up against `kotoba/` is where this repository differs from its siblings: the
names mostly match, and the **semantics systematically do not.**

| Dispatcher method | BPMN job type | kotoba export | name match |
|---|---|---|---|
| `processCheckIn` | `air.dcs.checkin.process` | `processCheckin` | **differs by one letter's case** |
| `processBoardingPass` | `air.dcs.boarding_pass.process` | — | **no counterpart** |
| `acceptBaggage` | `air.dcs.baggage.accept` | `acceptBaggage` | exact |
| `reconcileBaggage` | `air.dcs.baggage.reconcile` | `reconcileBaggage` | exact |
| `computeLoadSheet` | `air.dcs.load_sheet.compute` | `computeLoadSheet` | exact |
| `transmitApis` | `air.dcs.apis.transmit` | `transmitApis` | exact |
| `trackTurnaround` | `air.dcs.turnaround.track` | `trackTurnaround` | exact |
| `issueDepartureControl` | `air.dcs.departure.control` | `updateDeparture` | different name, **identical six domain fields** |

`issueDepartureControl` is the happy case: the contract takes `flightNo depDate
atd delayReason delayMins gate callerDid` and `UpdateDepartureInput` takes
`flightNo depDate status atd gate delayReason delayMins`. The six domain fields
line up exactly; the deltas are `callerDid` (contract only) and `status` (kotoba
takes it as an input, the contract returns it). Only the name was lost.

### The contract's outputs are kotoba's inputs

This is the finding that matters. For five of the eight processes, a value the
**contract declares the process produces** is a value **kotoba asks the caller to
supply**:

| Process | Contract returns | kotoba treats it as |
|---|---|---|
| `computeLoadSheet` | `zfwKg`, `towKg`, `lmcStatus` | **client-supplied inputs** |
| `acceptBaggage` | `tagNo` (bag tag) | **client-supplied** `bagTag` |
| `processCheckIn` | `seatNo`, `boardingPassRef` | `seatNo` **client-supplied**; no `boardingPassRef` at all |
| `trackTurnaround` | `targetTime`, `variance` | neither exists |
| `transmitApis` | `transmissionRef` | does not exist |

The direction of authorship is reversed. The contract describes a system that
*decides*; the implementation is one that *accepts and files*.

### The privacy models are different, not merely differently spelled

The contract passes `pnrIdHash` to `processCheckIn` and `acceptBaggage`, and
`paxManifestHash` to `transmitApis` — the substrate is never given the identity
at all. `kotoba` instead takes `passengerName`, `pnrRef`, `documentNumber`,
`nationality` and `dateOfBirth` in full and seals them in an E2E envelope. Both
are defensible designs. They are not the same design, and nothing in the repo
notes that a choice was made.

### Fourteen contract identifiers appear in none of the migrated files

`vertexId` `callerDid` `pnrIdHash` `paxManifestHash` `boardingPassRef`
`boardingPassBarcode` `transmissionRef` `reconcileStatus` `variance` `targetTime`
`milestone` `tagNo` `totalCargoKg` `destCountry` — all fourteen, zero files.
Every one of the eight processes returns `vertexId` and takes `callerDid`. The
registry cannot tell who is asking, and nothing anchors a graph vertex.

(They do now appear in this file and in the quickstart, which is why §3's search
excludes both. Naming a gap puts the name in the repository; the check has to
know the difference between prose and code.)

## `computeLoadSheet` does not compute

The function body contains **no arithmetic operator of any kind**. `zfwKg`,
`towKg` and `fuelKg` appear exactly twice each: once in a format-validation list,
once in a pass-through assignment. What it validates is that the caller sent
digits; what it never checks is whether the digits are possible.

Run against the mock, it accepts a load sheet with a take-off weight of **1 kg**
and a zero-fuel weight of **62,000 kg** — an aircraft carrying minus sixty-two
tonnes of fuel — and returns `status: "computed"`. §5 of the quickstart runs it.

`reconcileBaggage` is the same shape: it accepts `totalBags: 142` alongside
`loadedCount: 999, offloadedCount: 999, missingCount: 999` and returns
`status: "reconciled"`. The identity that makes a reconciliation *a
reconciliation* is never evaluated.

For a departure control system the regulatory half — *is this aircraft loaded
legally, are all the bags accounted for* — is exactly the half that does not
exist.

## Two of the ten tests do not measure what they are named

Ten tests pass. Eight mutations — dedup, FK enforcement, decimal validation,
required fields, list filters, timestamp merge — were all caught. The suite is
real. But two tests are named after safety properties they do not test, and both
were found only by breaking the property and watching them stay green.

**1. `"seals passenger manifest via encryptedWrite, never plaintext"`.** Rewrite
`transmitApis` to store the APIS manifest — passport number, nationality, date of
birth — as a **plaintext** record, keep the receipt shape intact, and **this test
passes.** Its plaintext assertion is:

```ts
expect(e.count("com.etzhayyim.apps.airDcs.flightDeparture")).toBe(0);
```

It counts `flightDeparture`, a collection `transmitApis` never writes to under any
circumstance. That assertion is `0` whether or not the manifest was sealed. What
actually catches the unmodified mutation is `expect(ok.keyId).toBeTruthy()` two
lines earlier — the receipt's *shape*, not the record's *secrecy*. The most
sensitive data in the repository is guarded by a proxy.

**2. `"enforces read-cap: a non-recipient DID cannot decrypt the checkin"`.** The
assertion is `expect((await listCheckins(outsider)).total).toBe(0)`, where
`outsider` is a second `MockEtzhayyim`. The mock's `store` and `encStore` are
per-instance private fields, so a second instance shares nothing with the first.
The assertion holds:

- with **nothing ever written**, and
- when the outsider **is a named recipient** and *should* be able to read.

Denial and entitlement return the same `0`. The test measures instance isolation
in the mock, not a read capability — and it passed unchanged when the checkin was
rewritten to a plaintext write.

Both are the same failure: **a check that could not measure returns the value of a
check that measured and found nothing wrong.**

## Smaller things that are true

- **The dispatcher's `methods` array is decorative.** `src/app.ts` routes on
  `nsid.startsWith("com.etzhayyim.apps.airDcs.")` and never consults the list.
  Against a stub upstream, a fabricated
  `com.etzhayyim.apps.airDcs.thisMethodDoesNotExist` is forwarded exactly like a
  declared one. The prefix *is* enforced (a foreign NSID gets 404).
- **The shared secret goes out empty.** `DISPATCHER_INTERNAL_SECRET` and
  `DISPATCHER_URL` are both absent from `wrangler.jsonc`, so the code falls back
  to the hardcoded host and `x-internal-secret: ""` — observed on the wire in §4.
  It does not fail closed.
- **The APIS collection is write-only.** `transmitApis` writes; there is no
  `getApis` and no `listApis`. `scanApisManifests` exists but is private and used
  only by `coverage`, so the manifests can be counted and never read back.
  `baggageRecord` has `getBaggage` but no `listBaggage`; `loadSheet`,
  `turnaround` and `baggageReconciliation` have `list` but no `get`. Only
  `flightDeparture` and `passengerCheckin` have both.
- **`getCheckin` and `getBaggage` are O(n) over the whole collection.** Both write
  at a deterministic rkey (`rkeyOf("chk", checkinId)`) and then look up by
  scanning and decrypting up to `DEFAULT_MAX_SCAN = 10_000` records before
  `.find()`. The key the write computed is not used by the read.
- **Four method vocabularies disagree.** `kotodama.jsonld` and
  `wrangler.jsonc` each advertise 3 capabilities (`processCheckIn`,
  `processBoardingPass`, `acceptBaggage`); `src/app.ts` lists 8; `kotoba`
  exports 17. Of the 3 advertised capabilities, one exists in kotoba
  (`acceptBaggage`), one differs by letter case, and one does not exist at all.

## Where to start

The contract survived and the storage layer under it is written and tested. That
makes the ordering unusually clear:

1. **Decide whether this app exists.** Four hostnames are NXDOMAIN and the
   upstream it was cut from has deleted its copy. Nothing below matters if the
   answer is no.
2. **If yes, fix the two blind tests first** — they are cheap, and until they are
   fixed every later change to the E2E path is unverified. Assert on the
   collection the function actually writes; give the outsider a view of the same
   store.
3. **Then write the computations the contract names** — zero-fuel/take-off weight,
   LMC status, bag-count identity, turnaround variance. That is the product.
4. **Then reconcile with the contract**: add `callerDid`, move `tagNo`/`seatNo`/
   `zfwKg`/`towKg` assignment server-side, and decide explicitly between
   `pnrIdHash` and sealed-plaintext. Write the decision down.
5. **Do not start with `MIGRATION-TODO.md`.** Its own scan found none of the
   violations it lists.

## Layout

```
src/app.ts                     edge dispatcher — not deployed
svelte/                        SvelteKit BFF — the deployed worker
kotoba/src/registry.ts         17 exports, plaintext/E2E split
kotoba/src/types.ts            record bodies, input types, validators
kotoba/test/air-dcs.test.ts    10 tests; 8/8 mutants killed, 2 blind spots
kotodama.jsonld                actor descriptor (context 404s)
wrangler.jsonc                 2 routes, 8 vars
migration.edn                  provenance — verified byte-identical
```

## Provenance

`migration.edn` claims 20 files and 67,306 bytes at tree `f489880e` from
`etzhayyim/root@0c30514a`. All four claims verify: the commit exists upstream
(2026-07-19), the tree holds exactly 20 blobs totalling 67,306 bytes, and **all
20 are byte-identical** to what is checked in here. The only additions are
`README.edn` and `migration.edn`, which is what `:identity :allowed-additions`
says. This file and `docs/operator-quickstart.md` were added on 2026-08-16 and
recorded there too — **if you add a file, add it to that list**, or the next
person to run the check in §1 of the quickstart will see drift that is not drift.
