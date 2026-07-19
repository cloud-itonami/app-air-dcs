/**
 * air-dcs kotoba — kotoba-E2E registry.
 *
 * Plaintext path (flightDeparture, loadSheet): sdk.write / sdk.read — flight-
 * level operational anchors. FK loadSheet → flightDeparture via exists()
 * (read + check). E2E path (passengerCheckin, baggageRecord, apisManifest):
 * sdk.encryptedWrite / sdk.encryptedRead — PII/LE bodies sealed in the kotoba
 * envelope (ADR-2605181100), read-cap = owner DID + explicit recipients. The
 * substrate never sees passenger identity, document numbers, or APIS manifests
 * in plaintext.
 *
 * IATA-BSP fiat-clearing settlement EXECUTION for ticket fares stays etzhayyim
 * (consent-capability) — not modeled here as a collection.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  APIS_MANIFEST_INNER_TYPE,
  BAGGAGE_RECONCILIATION_COLLECTION,
  BAGGAGE_RECORD_INNER_TYPE,
  FLIGHT_DEPARTURE_COLLECTION,
  LOAD_SHEET_COLLECTION,
  PASSENGER_CHECKIN_INNER_TYPE,
  TURNAROUND_COLLECTION,
  flightDidFor,
  isDecimalString,
  isUint,
  loadSheetDidFor,
  reconciliationDidFor,
  rkeyOf,
  turnaroundDidFor,
  type AcceptBaggageInput,
  type AcceptBaggageOutput,
  type ApisManifestBody,
  type ApisManifestView,
  type BaggageReconciliationRecord,
  type BaggageReconciliationView,
  type BaggageRecordBody,
  type BaggageRecordView,
  type ComputeLoadSheetInput,
  type ComputeLoadSheetOutput,
  type CoverageInput,
  type CoverageOutput,
  type FlightDepartureRecord,
  type FlightDepartureView,
  type GetBaggageInput,
  type GetBaggageOutput,
  type GetCheckinInput,
  type GetCheckinOutput,
  type GetFlightInput,
  type GetFlightOutput,
  type ListCheckinsInput,
  type ListCheckinsOutput,
  type ListFlightsInput,
  type ListFlightsOutput,
  type ListLoadSheetsInput,
  type ListLoadSheetsOutput,
  type ListReconciliationsInput,
  type ListReconciliationsOutput,
  type ListTurnaroundsInput,
  type ListTurnaroundsOutput,
  type LoadSheetRecord,
  type LoadSheetView,
  type PassengerCheckinBody,
  type PassengerCheckinView,
  type ProcessCheckinInput,
  type ProcessCheckinOutput,
  type ReconcileBaggageInput,
  type ReconcileBaggageOutput,
  type RegisterFlightInput,
  type RegisterFlightOutput,
  type TrackTurnaroundInput,
  type TrackTurnaroundOutput,
  type TransmitApisInput,
  type TransmitApisOutput,
  type TurnaroundRecord,
  type TurnaroundView,
  type UpdateDepartureInput,
  type UpdateDepartureOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

function flightKeyOf(flightNo: string, depDate: string): string {
  return `${flightNo}-${depDate}`;
}

// ─── Plaintext FK helper (exists via read; mock has no exists()) ─────

async function flightExists(e: Etzhayyim, flightNo: string, depDate: string): Promise<boolean> {
  const rkey = rkeyOf("flt", flightKeyOf(flightNo, depDate));
  const resp = await e
    .read<FlightDepartureRecord>({ collection: FLIGHT_DEPARTURE_COLLECTION, rkey })
    .catch(() => ({ records: [] as Array<{ uri: string; value: FlightDepartureRecord }> }));
  return Boolean(resp.records[0]?.value);
}

// ─── Flight departure anchor (PLAINTEXT) ────────────────────────────

export async function registerFlight(e: Etzhayyim, input: RegisterFlightInput): Promise<RegisterFlightOutput> {
  if (!input.flightNo || !input.depDate) return { status: "rejected", error: "missingRequiredFields" };
  const flightKey = flightKeyOf(input.flightNo, input.depDate);
  const rkey = rkeyOf("flt", flightKey);
  const existing = await e.read<FlightDepartureRecord>({ collection: FLIGHT_DEPARTURE_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", departureUri: existing.records[0].uri, did: existing.records[0].value.did, flightKey };
  }
  const now = new Date().toISOString();
  const did = flightDidFor(input.flightNo, input.depDate);
  const record: FlightDepartureRecord = {
    did,
    flightNo: input.flightNo,
    depDate: input.depDate,
    gate: input.gate,
    status: input.status ?? "scheduled",
    createdAt: now,
  };
  const receipt = await e.write({ collection: FLIGHT_DEPARTURE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", departureUri: receipt.uri, did, flightKey };
}

export async function updateDeparture(e: Etzhayyim, input: UpdateDepartureInput): Promise<UpdateDepartureOutput> {
  if (!input.flightNo || !input.depDate || !input.status) return { status: "rejected", error: "missingRequiredFields" };
  if (input.delayMins !== undefined && !isUint(input.delayMins)) return { status: "rejected", error: "invalidDelayMins" };
  const flightKey = flightKeyOf(input.flightNo, input.depDate);
  const rkey = rkeyOf("flt", flightKey);
  const existing = await e.read<FlightDepartureRecord>({ collection: FLIGHT_DEPARTURE_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const prior = existing.records[0]?.value;
  if (!prior) return { status: "rejected", error: "flightNotFound" };
  const updated: FlightDepartureRecord = {
    ...prior,
    status: input.status,
    atd: input.atd ?? prior.atd,
    gate: input.gate ?? prior.gate,
    delayReason: input.delayReason ?? prior.delayReason,
    delayMins: input.delayMins ?? prior.delayMins,
  };
  const receipt = await e.write({ collection: FLIGHT_DEPARTURE_COLLECTION, record: updated as unknown as Record<string, unknown>, rkey });
  return { status: "updated", departureUri: receipt.uri, flightKey };
}

export async function getFlight(e: Etzhayyim, input: GetFlightInput): Promise<GetFlightOutput> {
  if (!input.flightNo || !input.depDate) return { error: "missingRequiredFields" };
  const rkey = rkeyOf("flt", flightKeyOf(input.flightNo, input.depDate));
  const resp = await e.read<FlightDepartureRecord>({ collection: FLIGHT_DEPARTURE_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { flight: { ...r.value, departureUri: r.uri } };
}

export async function listFlights(e: Etzhayyim, input: ListFlightsInput = {}): Promise<ListFlightsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<FlightDepartureRecord>({ collection: FLIGHT_DEPARTURE_COLLECTION, cursor: input.cursor, limit });
  const items: FlightDepartureView[] = resp.records
    .filter((r) => (!input.status || r.value.status === input.status) && (!input.gate || r.value.gate === input.gate))
    .map((r) => ({ ...r.value, departureUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Load sheet (PLAINTEXT, FK → flightDeparture) ───────────────────

export async function computeLoadSheet(e: Etzhayyim, input: ComputeLoadSheetInput): Promise<ComputeLoadSheetOutput> {
  if (!input.flightNo || !input.depDate) return { status: "rejected", error: "missingRequiredFields" };
  if (input.totalPax !== undefined && !isUint(input.totalPax)) return { status: "rejected", error: "invalidTotalPax" };
  if (input.bagCount !== undefined && !isUint(input.bagCount)) return { status: "rejected", error: "invalidBagCount" };
  for (const [field, val] of [
    ["bagWeightKg", input.bagWeightKg],
    ["cargoWeightKg", input.cargoWeightKg],
    ["fuelKg", input.fuelKg],
    ["zfwKg", input.zfwKg],
    ["towKg", input.towKg],
  ] as const) {
    if (val !== undefined && !isDecimalString(val)) return { status: "rejected", error: `invalid${field[0].toUpperCase()}${field.slice(1)}` };
  }
  if (!(await flightExists(e, input.flightNo, input.depDate))) return { status: "rejected", error: "flightNotFound" };
  const rkey = rkeyOf("ls", flightKeyOf(input.flightNo, input.depDate));
  const existing = await e.read<LoadSheetRecord>({ collection: LOAD_SHEET_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", loadSheetUri: existing.records[0].uri, did: existing.records[0].value.did };
  }
  const now = new Date().toISOString();
  const did = loadSheetDidFor(input.flightNo, input.depDate);
  const record: LoadSheetRecord = {
    did,
    flightNo: input.flightNo,
    depDate: input.depDate,
    aircraftType: input.aircraftType,
    totalPax: input.totalPax,
    bagCount: input.bagCount,
    bagWeightKg: input.bagWeightKg,
    cargoWeightKg: input.cargoWeightKg,
    fuelKg: input.fuelKg,
    zfwKg: input.zfwKg,
    towKg: input.towKg,
    lmcStatus: input.lmcStatus,
    status: input.status ?? "issued",
    createdAt: now,
  };
  const receipt = await e.write({ collection: LOAD_SHEET_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "computed", loadSheetUri: receipt.uri, did };
}

export async function listLoadSheets(e: Etzhayyim, input: ListLoadSheetsInput = {}): Promise<ListLoadSheetsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<LoadSheetRecord>({ collection: LOAD_SHEET_COLLECTION, cursor: input.cursor, limit });
  const items: LoadSheetView[] = resp.records
    .filter((r) => (!input.flightNo || r.value.flightNo === input.flightNo) && (!input.status || r.value.status === input.status))
    .map((r) => ({ ...r.value, loadSheetUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Turnaround (PLAINTEXT, FK → flightDeparture) ───────────────────

export async function trackTurnaround(e: Etzhayyim, input: TrackTurnaroundInput): Promise<TrackTurnaroundOutput> {
  if (!input.flightNo || !input.depDate || !input.phase) return { status: "rejected", error: "missingRequiredFields" };
  if (input.finalPaxCount !== undefined && !isUint(input.finalPaxCount)) return { status: "rejected", error: "invalidFinalPaxCount" };
  if (input.boardedCount !== undefined && !isUint(input.boardedCount)) return { status: "rejected", error: "invalidBoardedCount" };
  if (!(await flightExists(e, input.flightNo, input.depDate))) return { status: "rejected", error: "flightNotFound" };
  const rkey = rkeyOf("ta", flightKeyOf(input.flightNo, input.depDate));
  const existing = await e.read<TurnaroundRecord>({ collection: TURNAROUND_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const prior = existing.records[0]?.value;
  const now = new Date().toISOString();
  const did = prior?.did ?? turnaroundDidFor(input.flightNo, input.depDate);
  const record: TurnaroundRecord = {
    did,
    flightNo: input.flightNo,
    depDate: input.depDate,
    phase: input.phase,
    gateReadyTime: input.gateReadyTime ?? prior?.gateReadyTime,
    boardingStartTime: input.boardingStartTime ?? prior?.boardingStartTime,
    estimatedDepTime: input.estimatedDepTime ?? prior?.estimatedDepTime,
    actualDepTime: input.actualDepTime ?? prior?.actualDepTime,
    finalPaxCount: input.finalPaxCount ?? prior?.finalPaxCount,
    boardedCount: input.boardedCount ?? prior?.boardedCount,
    createdAt: prior?.createdAt ?? now,
  };
  const receipt = await e.write({ collection: TURNAROUND_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "tracked", turnaroundUri: receipt.uri, did };
}

export async function listTurnarounds(e: Etzhayyim, input: ListTurnaroundsInput = {}): Promise<ListTurnaroundsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<TurnaroundRecord>({ collection: TURNAROUND_COLLECTION, cursor: input.cursor, limit });
  const items: TurnaroundView[] = resp.records
    .filter((r) => (!input.flightNo || r.value.flightNo === input.flightNo) && (!input.phase || r.value.phase === input.phase))
    .map((r) => ({ ...r.value, turnaroundUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Baggage reconciliation (PLAINTEXT aggregate, FK → flightDeparture) ─

export async function reconcileBaggage(e: Etzhayyim, input: ReconcileBaggageInput): Promise<ReconcileBaggageOutput> {
  if (!input.flightNo || !input.depDate) return { status: "rejected", error: "missingRequiredFields" };
  for (const [field, val] of [
    ["totalBags", input.totalBags],
    ["loadedCount", input.loadedCount],
    ["offloadedCount", input.offloadedCount],
    ["missingCount", input.missingCount],
  ] as const) {
    if (val !== undefined && !isUint(val)) return { status: "rejected", error: `invalid${field[0].toUpperCase()}${field.slice(1)}` };
  }
  if (input.totalWeightKg !== undefined && !isDecimalString(input.totalWeightKg)) return { status: "rejected", error: "invalidTotalWeightKg" };
  if (!(await flightExists(e, input.flightNo, input.depDate))) return { status: "rejected", error: "flightNotFound" };
  const rkey = rkeyOf("brec", flightKeyOf(input.flightNo, input.depDate));
  const existing = await e.read<BaggageReconciliationRecord>({ collection: BAGGAGE_RECONCILIATION_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const prior = existing.records[0]?.value;
  const now = new Date().toISOString();
  const did = prior?.did ?? reconciliationDidFor(input.flightNo, input.depDate);
  const record: BaggageReconciliationRecord = {
    did,
    flightNo: input.flightNo,
    depDate: input.depDate,
    totalBags: input.totalBags ?? prior?.totalBags,
    loadedCount: input.loadedCount ?? prior?.loadedCount,
    offloadedCount: input.offloadedCount ?? prior?.offloadedCount,
    missingCount: input.missingCount ?? prior?.missingCount,
    totalWeightKg: input.totalWeightKg ?? prior?.totalWeightKg,
    status: input.status ?? prior?.status ?? "reconciled",
    createdAt: prior?.createdAt ?? now,
  };
  const receipt = await e.write({ collection: BAGGAGE_RECONCILIATION_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "reconciled", reconciliationUri: receipt.uri, did };
}

export async function listReconciliations(e: Etzhayyim, input: ListReconciliationsInput = {}): Promise<ListReconciliationsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<BaggageReconciliationRecord>({ collection: BAGGAGE_RECONCILIATION_COLLECTION, cursor: input.cursor, limit });
  const items: BaggageReconciliationView[] = resp.records
    .filter((r) => !input.flightNo || r.value.flightNo === input.flightNo)
    .map((r) => ({ ...r.value, reconciliationUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Passenger check-in (E2E-ENCRYPTED, PII) ────────────────────────

export async function processCheckin(e: Etzhayyim, input: ProcessCheckinInput): Promise<ProcessCheckinOutput> {
  if (!input.checkinId || !input.flightNo || !input.depDate || !input.passengerName || !input.pnrRef) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const body: PassengerCheckinBody = {
    checkinId: input.checkinId,
    flightNo: input.flightNo,
    depDate: input.depDate,
    passengerName: input.passengerName,
    pnrRef: input.pnrRef,
    passengerDid: input.passengerDid,
    docHash: input.docHash,
    seatNo: input.seatNo,
    boardingGroup: input.boardingGroup,
    channel: input.channel,
    status: input.status ?? "checked-in",
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: PASSENGER_CHECKIN_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("chk", input.checkinId),
  });
  return { status: "checkedIn", uri: receipt.uri, keyId: receipt.keyId, checkinId: input.checkinId };
}

async function scanCheckins(e: Etzhayyim, maxScan: number): Promise<PassengerCheckinView[]> {
  const out: PassengerCheckinView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<PassengerCheckinBody>({ innerType: PASSENGER_CHECKIN_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getCheckin(e: Etzhayyim, input: GetCheckinInput): Promise<GetCheckinOutput> {
  if (!input.checkinId) return { error: "invalidCheckinId" };
  const all = await scanCheckins(e, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.checkinId === input.checkinId);
  if (!found) return { error: "notFound" };
  return { checkin: found };
}

export async function listCheckins(e: Etzhayyim, input: ListCheckinsInput = {}): Promise<ListCheckinsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanCheckins(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (c) =>
      (!input.flightNo || c.flightNo === input.flightNo) &&
      (!input.depDate || c.depDate === input.depDate) &&
      (!input.status || c.status === input.status),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Baggage record (E2E-ENCRYPTED, per-passenger baggage PII) ──────

export async function acceptBaggage(e: Etzhayyim, input: AcceptBaggageInput): Promise<AcceptBaggageOutput> {
  if (!input.bagTag || !input.checkinId || !input.flightNo || !input.depDate) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.weightKg)) return { status: "rejected", error: "invalidWeightKg" };
  const body: BaggageRecordBody = {
    bagTag: input.bagTag,
    checkinId: input.checkinId,
    flightNo: input.flightNo,
    depDate: input.depDate,
    pnrRef: input.pnrRef,
    weightKg: input.weightKg,
    destination: input.destination,
    status: input.status ?? "accepted",
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: BAGGAGE_RECORD_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("bag", input.bagTag),
  });
  return { status: "accepted", uri: receipt.uri, keyId: receipt.keyId, bagTag: input.bagTag };
}

async function scanBaggage(e: Etzhayyim, maxScan: number): Promise<BaggageRecordView[]> {
  const out: BaggageRecordView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<BaggageRecordBody>({ innerType: BAGGAGE_RECORD_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getBaggage(e: Etzhayyim, input: GetBaggageInput): Promise<GetBaggageOutput> {
  if (!input.bagTag) return { error: "invalidBagTag" };
  const all = await scanBaggage(e, DEFAULT_MAX_SCAN);
  const found = all.find((b) => b.bagTag === input.bagTag);
  if (!found) return { error: "notFound" };
  return { baggage: found };
}

// ─── APIS manifest (E2E-ENCRYPTED, LE/PII government transmission) ──

export async function transmitApis(e: Etzhayyim, input: TransmitApisInput): Promise<TransmitApisOutput> {
  if (!input.manifestId || !input.flightNo || !input.depDate || !input.destinationCountry || !input.passengerName || !input.documentNumber) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const body: ApisManifestBody = {
    manifestId: input.manifestId,
    flightNo: input.flightNo,
    depDate: input.depDate,
    destinationCountry: input.destinationCountry,
    passengerName: input.passengerName,
    documentNumber: input.documentNumber,
    documentType: input.documentType,
    nationality: input.nationality,
    dateOfBirth: input.dateOfBirth,
    transmittedAt: new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: APIS_MANIFEST_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("apis", input.manifestId),
  });
  return { status: "transmitted", uri: receipt.uri, keyId: receipt.keyId, manifestId: input.manifestId };
}

async function scanApisManifests(e: Etzhayyim, maxScan: number): Promise<ApisManifestView[]> {
  const out: ApisManifestView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<ApisManifestBody>({ innerType: APIS_MANIFEST_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

// ─── Coverage rollup (plaintext + E2E countAll) ─────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const flightsByStatus: Record<string, number> = {};
  let flightDepartureCount = 0;
  let fltCursor: string | undefined;
  while (flightDepartureCount < maxScan) {
    const page = await e.read<FlightDepartureRecord>({ collection: FLIGHT_DEPARTURE_COLLECTION, cursor: fltCursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      flightsByStatus[r.value.status] = (flightsByStatus[r.value.status] ?? 0) + 1;
      flightDepartureCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    fltCursor = page.cursor;
  }
  let loadSheetCount = 0;
  let lsCursor: string | undefined;
  while (loadSheetCount < maxScan) {
    const page = await e.read<LoadSheetRecord>({ collection: LOAD_SHEET_COLLECTION, cursor: lsCursor, limit: PAGE_LIMIT });
    loadSheetCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    lsCursor = page.cursor;
  }
  let turnaroundCount = 0;
  let taCursor: string | undefined;
  while (turnaroundCount < maxScan) {
    const page = await e.read<TurnaroundRecord>({ collection: TURNAROUND_COLLECTION, cursor: taCursor, limit: PAGE_LIMIT });
    turnaroundCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    taCursor = page.cursor;
  }
  let baggageReconciliationCount = 0;
  let brecCursor: string | undefined;
  while (baggageReconciliationCount < maxScan) {
    const page = await e.read<BaggageReconciliationRecord>({ collection: BAGGAGE_RECONCILIATION_COLLECTION, cursor: brecCursor, limit: PAGE_LIMIT });
    baggageReconciliationCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    brecCursor = page.cursor;
  }
  const passengerCheckinCount = (await scanCheckins(e, maxScan)).length;
  const baggageRecordCount = (await scanBaggage(e, maxScan)).length;
  const apisManifestCount = (await scanApisManifests(e, maxScan)).length;
  return {
    flightDepartureCount,
    loadSheetCount,
    turnaroundCount,
    baggageReconciliationCount,
    passengerCheckinCount,
    baggageRecordCount,
    apisManifestCount,
    flightsByStatus,
    truncated:
      flightDepartureCount >= maxScan ||
      loadSheetCount >= maxScan ||
      turnaroundCount >= maxScan ||
      baggageReconciliationCount >= maxScan ||
      passengerCheckinCount >= maxScan ||
      baggageRecordCount >= maxScan ||
      apisManifestCount >= maxScan,
  };
}
