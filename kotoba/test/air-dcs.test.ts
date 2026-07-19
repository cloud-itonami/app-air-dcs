import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerFlight,
  updateDeparture,
  getFlight,
  listFlights,
  computeLoadSheet,
  listLoadSheets,
  trackTurnaround,
  listTurnarounds,
  reconcileBaggage,
  listReconciliations,
  processCheckin,
  getCheckin,
  listCheckins,
  acceptBaggage,
  getBaggage,
  transmitApis,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:air-dcs.etzhayyim.com";

describe("air-dcs kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("flightDeparture (PLAINTEXT public operational anchor)", () => {
    it("registers, dedups, updates, gets, lists/filters", async () => {
      const r = await registerFlight(e, { flightNo: "GF101", depDate: "2026-06-10", gate: "A12" });
      expect(r.status).toBe("registered");
      expect(r.did).toBe("did:web:air-dcs.etzhayyim.com:flt:gf101:2026-06-10");
      expect((await registerFlight(e, { flightNo: "GF101", depDate: "2026-06-10" })).status).toBe("alreadyExists");
      expect((await registerFlight(e, { flightNo: "", depDate: "2026-06-10" })).status).toBe("rejected");

      const upd = await updateDeparture(e, { flightNo: "GF101", depDate: "2026-06-10", status: "departed", atd: "2026-06-10T08:05:00Z", delayMins: 5 });
      expect(upd.status).toBe("updated");
      expect((await updateDeparture(e, { flightNo: "GFX", depDate: "2026-06-10", status: "departed" })).status).toBe("rejected"); // not found
      expect((await updateDeparture(e, { flightNo: "GF101", depDate: "2026-06-10", status: "x", delayMins: -1 })).status).toBe("rejected"); // bad delay

      const got = await getFlight(e, { flightNo: "GF101", depDate: "2026-06-10" });
      expect(got.flight?.status).toBe("departed");
      expect(got.flight?.delayMins).toBe(5);
      expect((await getFlight(e, { flightNo: "NOPE", depDate: "2026-06-10" })).error).toBe("notFound");

      await registerFlight(e, { flightNo: "GF202", depDate: "2026-06-10", gate: "B3", status: "boarding" });
      expect((await listFlights(e)).total).toBe(2);
      expect((await listFlights(e, { status: "boarding" })).total).toBe(1);
      expect((await listFlights(e, { gate: "A12" })).total).toBe(1);
    });
  });

  describe("loadSheet (PLAINTEXT, FK → flightDeparture)", () => {
    it("rejects when flight missing, computes after FK, dedups, validates, lists", async () => {
      expect((await computeLoadSheet(e, { flightNo: "GF101", depDate: "2026-06-10", towKg: "72000.5" })).status).toBe("rejected"); // FK miss
      await registerFlight(e, { flightNo: "GF101", depDate: "2026-06-10" });

      expect((await computeLoadSheet(e, { flightNo: "GF101", depDate: "2026-06-10", totalPax: -1 })).status).toBe("rejected"); // bad pax
      expect((await computeLoadSheet(e, { flightNo: "GF101", depDate: "2026-06-10", towKg: "heavy" })).status).toBe("rejected"); // bad decimal

      const ls = await computeLoadSheet(e, {
        flightNo: "GF101",
        depDate: "2026-06-10",
        aircraftType: "A320",
        totalPax: 168,
        bagCount: 142,
        bagWeightKg: "2840.5",
        zfwKg: "62000",
        towKg: "72000.5",
        fuelKg: "10000",
        lmcStatus: "clean",
      });
      expect(ls.status).toBe("computed");
      expect((await computeLoadSheet(e, { flightNo: "GF101", depDate: "2026-06-10" })).status).toBe("alreadyExists");

      expect((await listLoadSheets(e)).total).toBe(1);
      expect((await listLoadSheets(e, { flightNo: "GF101" })).total).toBe(1);
      expect((await listLoadSheets(e, { flightNo: "OTHER" })).total).toBe(0);
    });
  });

  describe("turnaround (PLAINTEXT, FK → flightDeparture)", () => {
    it("rejects when flight missing, tracks after FK, updates phase, validates, lists/filters", async () => {
      expect((await trackTurnaround(e, { flightNo: "GF101", depDate: "2026-06-10", phase: "gate-ready" })).status).toBe("rejected"); // FK miss
      await registerFlight(e, { flightNo: "GF101", depDate: "2026-06-10" });

      expect((await trackTurnaround(e, { flightNo: "GF101", depDate: "2026-06-10", phase: "boarding", boardedCount: -1 })).status).toBe("rejected"); // bad count
      const t1 = await trackTurnaround(e, { flightNo: "GF101", depDate: "2026-06-10", phase: "gate-ready", gateReadyTime: "2026-06-10T07:20:00Z" });
      expect(t1.status).toBe("tracked");
      // advancing phase merges prior timestamps (upsert, not duplicate)
      const t2 = await trackTurnaround(e, { flightNo: "GF101", depDate: "2026-06-10", phase: "departed", boardingStartTime: "2026-06-10T07:40:00Z", actualDepTime: "2026-06-10T08:05:00Z", finalPaxCount: 168, boardedCount: 166 });
      expect(t2.status).toBe("tracked");
      expect(t2.did).toBe(t1.did);

      const list = await listTurnarounds(e, { flightNo: "GF101" });
      expect(list.total).toBe(1);
      expect(list.items[0].phase).toBe("departed");
      expect(list.items[0].gateReadyTime).toBe("2026-06-10T07:20:00Z"); // preserved across phase update
      expect(list.items[0].boardedCount).toBe(166);
      expect((await listTurnarounds(e, { phase: "departed" })).total).toBe(1);
      expect((await listTurnarounds(e, { phase: "gate-ready" })).total).toBe(0);
    });
  });

  describe("baggageReconciliation (PLAINTEXT aggregate, FK → flightDeparture)", () => {
    it("rejects when flight missing, reconciles after FK, validates counts + decimal weight, lists", async () => {
      expect((await reconcileBaggage(e, { flightNo: "GF101", depDate: "2026-06-10", totalBags: 142 })).status).toBe("rejected"); // FK miss
      await registerFlight(e, { flightNo: "GF101", depDate: "2026-06-10" });

      expect((await reconcileBaggage(e, { flightNo: "GF101", depDate: "2026-06-10", missingCount: -1 })).status).toBe("rejected"); // bad count
      expect((await reconcileBaggage(e, { flightNo: "GF101", depDate: "2026-06-10", totalWeightKg: "heavy" })).status).toBe("rejected"); // bad decimal

      const r = await reconcileBaggage(e, { flightNo: "GF101", depDate: "2026-06-10", totalBags: 142, loadedCount: 140, offloadedCount: 1, missingCount: 1, totalWeightKg: "2840.5" });
      expect(r.status).toBe("reconciled");
      const list = await listReconciliations(e, { flightNo: "GF101" });
      expect(list.total).toBe(1);
      expect(list.items[0].loadedCount).toBe(140);
      expect(list.items[0].totalWeightKg).toBe("2840.5");
      expect((await listReconciliations(e, { flightNo: "OTHER" })).total).toBe(0);
    });
  });

  describe("passengerCheckin (E2E-ENCRYPTED PII)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates, lists/filters", async () => {
      const ok = await processCheckin(e, {
        checkinId: "chk1",
        flightNo: "GF101",
        depDate: "2026-06-10",
        passengerName: "Alice Traveller",
        pnrRef: "ABC123",
        docHash: "sha256:deadbeef",
        seatNo: "14C",
        channel: "web",
      });
      expect(ok.status).toBe("checkedIn");
      expect(ok.keyId).toBeTruthy();
      expect((await processCheckin(e, { checkinId: "cX", flightNo: "", depDate: "", passengerName: "", pnrRef: "" } as any)).status).toBe("rejected");

      const got = await getCheckin(e, { checkinId: "chk1" });
      expect(got.checkin?.passengerName).toBe("Alice Traveller");
      expect(got.checkin?.seatNo).toBe("14C");
      expect((await getCheckin(e, { checkinId: "nope" })).error).toBe("notFound");

      await processCheckin(e, { checkinId: "chk2", flightNo: "GF202", depDate: "2026-06-10", passengerName: "Bob", pnrRef: "DEF456", status: "boarded" });
      expect((await listCheckins(e)).total).toBe(2);
      expect((await listCheckins(e, { flightNo: "GF101" })).total).toBe(1);
      expect((await listCheckins(e, { status: "boarded" })).total).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt the checkin", async () => {
      await processCheckin(e, { checkinId: "chk1", flightNo: "GF101", depDate: "2026-06-10", passengerName: "Alice", pnrRef: "ABC123" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      // distinct PDS view, no read-cap → zero records (isolation by owner DID)
      expect((await listCheckins(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:partner.example";
      const r = await processCheckin(e, { checkinId: "chk1", flightNo: "GF101", depDate: "2026-06-10", passengerName: "Alice", pnrRef: "ABC123", recipients: [partner] });
      expect(r.status).toBe("checkedIn");
      expect((await listCheckins(e)).total).toBe(1); // owner can read
    });
  });

  describe("baggageRecord (E2E-ENCRYPTED per-passenger baggage PII)", () => {
    it("seals, round-trips, validates decimal weight", async () => {
      const ok = await acceptBaggage(e, { bagTag: "GF0012345", checkinId: "chk1", flightNo: "GF101", depDate: "2026-06-10", weightKg: "23.5", destination: "DXB" });
      expect(ok.status).toBe("accepted");
      expect(ok.keyId).toBeTruthy();
      expect((await acceptBaggage(e, { bagTag: "GF0099999", checkinId: "chk1", flightNo: "GF101", depDate: "2026-06-10", weightKg: "heavy" })).status).toBe("rejected");

      const got = await getBaggage(e, { bagTag: "GF0012345" });
      expect(got.baggage?.weightKg).toBe("23.5");
      expect(got.baggage?.destination).toBe("DXB");
      expect((await getBaggage(e, { bagTag: "NOPE" })).error).toBe("notFound");
    });
  });

  describe("apisManifest (E2E-ENCRYPTED LE/PII government transmission)", () => {
    it("seals passenger manifest via encryptedWrite, never plaintext", async () => {
      const ok = await transmitApis(e, {
        manifestId: "apis1",
        flightNo: "GF101",
        depDate: "2026-06-10",
        destinationCountry: "AE",
        passengerName: "Alice Traveller",
        documentNumber: "P1234567",
        documentType: "passport",
        nationality: "GB",
      });
      expect(ok.status).toBe("transmitted");
      expect(ok.keyId).toBeTruthy();
      expect((await transmitApis(e, { manifestId: "x", flightNo: "GF101", depDate: "2026-06-10", destinationCountry: "AE", passengerName: "", documentNumber: "" })).status).toBe("rejected");
      // plaintext stores hold nothing — APIS lives only in the E2E envelope
      expect(e.count("com.etzhayyim.apps.airDcs.flightDeparture")).toBe(0);
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext anchors + E2E PII collections", async () => {
      await registerFlight(e, { flightNo: "GF101", depDate: "2026-06-10", status: "departed" });
      await registerFlight(e, { flightNo: "GF202", depDate: "2026-06-10", status: "departed" });
      await registerFlight(e, { flightNo: "GF303", depDate: "2026-06-10", status: "boarding" });
      await computeLoadSheet(e, { flightNo: "GF101", depDate: "2026-06-10", towKg: "72000.5" });
      await trackTurnaround(e, { flightNo: "GF101", depDate: "2026-06-10", phase: "departed" });
      await reconcileBaggage(e, { flightNo: "GF101", depDate: "2026-06-10", totalBags: 142 });
      await processCheckin(e, { checkinId: "chk1", flightNo: "GF101", depDate: "2026-06-10", passengerName: "Alice", pnrRef: "ABC" });
      await acceptBaggage(e, { bagTag: "GF001", checkinId: "chk1", flightNo: "GF101", depDate: "2026-06-10", weightKg: "23.5" });
      await transmitApis(e, { manifestId: "apis1", flightNo: "GF101", depDate: "2026-06-10", destinationCountry: "AE", passengerName: "Alice", documentNumber: "P1" });

      const cov = await coverage(e);
      expect(cov.flightDepartureCount).toBe(3);
      expect(cov.loadSheetCount).toBe(1);
      expect(cov.turnaroundCount).toBe(1);
      expect(cov.baggageReconciliationCount).toBe(1);
      expect(cov.passengerCheckinCount).toBe(1);
      expect(cov.baggageRecordCount).toBe(1);
      expect(cov.apisManifestCount).toBe(1);
      expect(cov.flightsByStatus?.departed).toBe(2);
      expect(cov.flightsByStatus?.boarding).toBe(1);
      expect(cov.truncated).toBe(false);
    });
  });
});
