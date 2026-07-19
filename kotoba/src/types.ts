/**
 * air-dcs kotoba — kotoba-E2E split for airline Departure Control System.
 *
 * Per ADR-2606011400 (Consensys) + ADR-2605172400 (3-axis) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03: PII /
 * CUI / LE may migrate to etzhayyim when made safe via kotoba E2E.
 *
 * SPLIT (discriminator: a field is E2E if it carries a passenger identity, a
 * travel-document number, a per-person baggage linkage, or a government
 * passenger-manifest transmission; pure flight-level operational facts are
 * plaintext):
 *
 *   PUBLIC (plaintext AT records) — flight-level operational anchors with NO
 *   passenger identity: `flightDeparture` (flight_no, dep_date, gate, atd,
 *   status, delay), `loadSheet` (weight-and-balance + aggregate pax/cargo
 *   counts — no person identity), `turnaround` (gate phase + ramp timestamps:
 *   gate-ready / boarding-start / estimated- & actual-dep — flight-level ops
 *   facts, the mv_air_turnaround_kpi source), and `baggageReconciliation`
 *   (flight-level loaded/offloaded/missing bag aggregates — derivable counts
 *   that the E2E per-bag records intentionally cannot expose to the substrate).
 *   FK loadSheet / turnaround / baggageReconciliation → flightDeparture via
 *   exists(). Frontable open ops metadata + aggregate stats.
 *
 *   SENSITIVE (kotoba E2E, com.etzhayyim.encrypted.record) — `passengerCheckin`
 *   (passenger name + PNR + travel-document hash + seat = PII), `baggageRecord`
 *   (bag tag + PNR linkage + weight = per-passenger baggage PII), and
 *   `apisManifest` (Advance Passenger Information transmitted to destination
 *   government = LE/PII passenger manifest). Written via sdk.encryptedWrite
 *   (read-cap = owner DID + explicit recipients). The substrate never sees
 *   passenger identity, document numbers, or APIS manifests in plaintext.
 *
 *   STAYS etzhayyim (consumed via consent-capability, NOT a collection) — IATA-BSP
 *   fiat-clearing settlement EXECUTION for ticket fares. Per Operating Entity
 *   Boundary (ADR-2605172100) etzhayyim never becomes the fiat MoR/counterparty
 *   (on-chain USDC only), so the BSP fiat-rail settlement CALL stays etzhayyim; the
 *   passenger/baggage/manifest DATA is fronted E2E here.
 *
 * AT-Lexicon: no float — weights are decimal STRINGS; counts/minutes are
 * integers.
 */

// ─── Plaintext public collections ───────────────────────────────────
export const FLIGHT_DEPARTURE_COLLECTION = "com.etzhayyim.apps.airDcs.flightDeparture";
export const LOAD_SHEET_COLLECTION = "com.etzhayyim.apps.airDcs.loadSheet";
export const TURNAROUND_COLLECTION = "com.etzhayyim.apps.airDcs.turnaround";
export const BAGGAGE_RECONCILIATION_COLLECTION = "com.etzhayyim.apps.airDcs.baggageReconciliation";

// ─── E2E inner-type NSIDs (body shape inside the encrypted envelope) ──
export const PASSENGER_CHECKIN_INNER_TYPE = "com.etzhayyim.apps.airDcs.passengerCheckin";
export const BAGGAGE_RECORD_INNER_TYPE = "com.etzhayyim.apps.airDcs.baggageRecord";
export const APIS_MANIFEST_INNER_TYPE = "com.etzhayyim.apps.airDcs.apisManifest";

export const AIR_DCS_DID_PREFIX = "did:web:air-dcs.etzhayyim.com:" as const;

// ─── Flight departure anchor (PLAINTEXT, public operational metadata) ─

export interface FlightDepartureRecord {
  did: string;
  flightNo: string;
  depDate: string;
  gate?: string;
  status: string;
  /** actual time of departure (ISO string). */
  atd?: string;
  delayReason?: string;
  /** delay in minutes (integer). */
  delayMins?: number;
  createdAt: string;
}
export interface FlightDepartureView extends FlightDepartureRecord {
  departureUri: string;
}
export interface RegisterFlightInput {
  flightNo: string;
  depDate: string;
  gate?: string;
  status?: string;
}
export interface RegisterFlightOutput {
  status: "registered" | "alreadyExists" | "rejected";
  departureUri?: string;
  did?: string;
  flightKey?: string;
  error?: string;
}
export interface UpdateDepartureInput {
  flightNo: string;
  depDate: string;
  status: string;
  atd?: string;
  gate?: string;
  delayReason?: string;
  delayMins?: number;
}
export interface UpdateDepartureOutput {
  status: "updated" | "rejected";
  departureUri?: string;
  flightKey?: string;
  error?: string;
}
export interface GetFlightInput {
  flightNo: string;
  depDate: string;
}
export interface GetFlightOutput {
  flight?: FlightDepartureView;
  error?: string;
}
export interface ListFlightsInput {
  status?: string;
  gate?: string;
  limit?: number;
  cursor?: string;
}
export interface ListFlightsOutput {
  items: FlightDepartureView[];
  cursor?: string;
  total: number;
}

// ─── Load sheet (PLAINTEXT, FK → flightDeparture) ───────────────────

export interface LoadSheetRecord {
  did: string;
  flightNo: string;
  depDate: string;
  aircraftType?: string;
  /** aggregate counts (integer, no person identity). */
  totalPax?: number;
  bagCount?: number;
  /** decimal kilograms as strings (no float). */
  bagWeightKg?: string;
  cargoWeightKg?: string;
  fuelKg?: string;
  zfwKg?: string;
  towKg?: string;
  lmcStatus?: string;
  status: string;
  createdAt: string;
}
export interface LoadSheetView extends LoadSheetRecord {
  loadSheetUri: string;
}
export interface ComputeLoadSheetInput {
  flightNo: string;
  depDate: string;
  aircraftType?: string;
  totalPax?: number;
  bagCount?: number;
  bagWeightKg?: string;
  cargoWeightKg?: string;
  fuelKg?: string;
  zfwKg?: string;
  towKg?: string;
  lmcStatus?: string;
  status?: string;
}
export interface ComputeLoadSheetOutput {
  status: "computed" | "alreadyExists" | "rejected";
  loadSheetUri?: string;
  did?: string;
  error?: string;
}
export interface ListLoadSheetsInput {
  flightNo?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}
export interface ListLoadSheetsOutput {
  items: LoadSheetView[];
  cursor?: string;
  total: number;
}

// ─── Turnaround (PLAINTEXT, FK → flightDeparture) ───────────────────

export interface TurnaroundRecord {
  did: string;
  flightNo: string;
  depDate: string;
  phase: string;
  gateReadyTime?: string;
  boardingStartTime?: string;
  estimatedDepTime?: string;
  actualDepTime?: string;
  /** aggregate counts (integer, no person identity). */
  finalPaxCount?: number;
  boardedCount?: number;
  createdAt: string;
}
export interface TurnaroundView extends TurnaroundRecord {
  turnaroundUri: string;
}
export interface TrackTurnaroundInput {
  flightNo: string;
  depDate: string;
  phase: string;
  gateReadyTime?: string;
  boardingStartTime?: string;
  estimatedDepTime?: string;
  actualDepTime?: string;
  finalPaxCount?: number;
  boardedCount?: number;
}
export interface TrackTurnaroundOutput {
  status: "tracked" | "rejected";
  turnaroundUri?: string;
  did?: string;
  error?: string;
}
export interface ListTurnaroundsInput {
  flightNo?: string;
  phase?: string;
  limit?: number;
  cursor?: string;
}
export interface ListTurnaroundsOutput {
  items: TurnaroundView[];
  cursor?: string;
  total: number;
}

// ─── Baggage reconciliation (PLAINTEXT aggregate, FK → flightDeparture) ─

export interface BaggageReconciliationRecord {
  did: string;
  flightNo: string;
  depDate: string;
  /** aggregate bag counts (integer). */
  totalBags?: number;
  loadedCount?: number;
  offloadedCount?: number;
  missingCount?: number;
  /** decimal kilograms as string (no float). */
  totalWeightKg?: string;
  status: string;
  createdAt: string;
}
export interface BaggageReconciliationView extends BaggageReconciliationRecord {
  reconciliationUri: string;
}
export interface ReconcileBaggageInput {
  flightNo: string;
  depDate: string;
  totalBags?: number;
  loadedCount?: number;
  offloadedCount?: number;
  missingCount?: number;
  totalWeightKg?: string;
  status?: string;
}
export interface ReconcileBaggageOutput {
  status: "reconciled" | "rejected";
  reconciliationUri?: string;
  did?: string;
  error?: string;
}
export interface ListReconciliationsInput {
  flightNo?: string;
  limit?: number;
  cursor?: string;
}
export interface ListReconciliationsOutput {
  items: BaggageReconciliationView[];
  cursor?: string;
  total: number;
}

// ─── Passenger check-in (E2E-ENCRYPTED, PII) ────────────────────────

export interface PassengerCheckinBody {
  checkinId: string;
  flightNo: string;
  depDate: string;
  passengerName: string;
  pnrRef: string;
  passengerDid?: string;
  docHash?: string;
  seatNo?: string;
  boardingGroup?: string;
  channel?: string;
  status: string;
}
export interface PassengerCheckinView extends PassengerCheckinBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface ProcessCheckinInput {
  checkinId: string;
  flightNo: string;
  depDate: string;
  passengerName: string;
  pnrRef: string;
  passengerDid?: string;
  docHash?: string;
  seatNo?: string;
  boardingGroup?: string;
  channel?: string;
  status?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface ProcessCheckinOutput {
  status: "checkedIn" | "rejected";
  uri?: string;
  keyId?: string;
  checkinId?: string;
  error?: string;
}
export interface GetCheckinInput {
  checkinId: string;
}
export interface GetCheckinOutput {
  checkin?: PassengerCheckinView;
  error?: string;
}
export interface ListCheckinsInput {
  flightNo?: string;
  depDate?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}
export interface ListCheckinsOutput {
  items: PassengerCheckinView[];
  cursor?: string;
  total: number;
}

// ─── Baggage record (E2E-ENCRYPTED, per-passenger baggage PII) ──────

export interface BaggageRecordBody {
  bagTag: string;
  checkinId: string;
  flightNo: string;
  depDate: string;
  pnrRef?: string;
  /** decimal kilograms as string (no float). */
  weightKg: string;
  destination?: string;
  status: string;
}
export interface BaggageRecordView extends BaggageRecordBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface AcceptBaggageInput {
  bagTag: string;
  checkinId: string;
  flightNo: string;
  depDate: string;
  pnrRef?: string;
  weightKg: string;
  destination?: string;
  status?: string;
  recipients?: string[];
}
export interface AcceptBaggageOutput {
  status: "accepted" | "rejected";
  uri?: string;
  keyId?: string;
  bagTag?: string;
  error?: string;
}
export interface GetBaggageInput {
  bagTag: string;
}
export interface GetBaggageOutput {
  baggage?: BaggageRecordView;
  error?: string;
}

// ─── APIS manifest (E2E-ENCRYPTED, LE/PII government transmission) ──

export interface ApisManifestBody {
  manifestId: string;
  flightNo: string;
  depDate: string;
  destinationCountry: string;
  passengerName: string;
  documentNumber: string;
  documentType?: string;
  nationality?: string;
  dateOfBirth?: string;
  transmittedAt: string;
}
export interface ApisManifestView extends ApisManifestBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface TransmitApisInput {
  manifestId: string;
  flightNo: string;
  depDate: string;
  destinationCountry: string;
  passengerName: string;
  documentNumber: string;
  documentType?: string;
  nationality?: string;
  dateOfBirth?: string;
  recipients?: string[];
}
export interface TransmitApisOutput {
  status: "transmitted" | "rejected";
  uri?: string;
  keyId?: string;
  manifestId?: string;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  flightDepartureCount?: number;
  loadSheetCount?: number;
  turnaroundCount?: number;
  baggageReconciliationCount?: number;
  passengerCheckinCount?: number;
  baggageRecordCount?: number;
  apisManifestCount?: number;
  flightsByStatus?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
/** Non-empty decimal string (e.g. "1250.5"); no float fields allowed. */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function flightDidFor(flightNo: string, depDate: string): string {
  return `${AIR_DCS_DID_PREFIX}flt:${flightNo.toLowerCase()}:${depDate.toLowerCase()}`;
}
export function loadSheetDidFor(flightNo: string, depDate: string): string {
  return `${AIR_DCS_DID_PREFIX}ls:${flightNo.toLowerCase()}:${depDate.toLowerCase()}`;
}
export function turnaroundDidFor(flightNo: string, depDate: string): string {
  return `${AIR_DCS_DID_PREFIX}ta:${flightNo.toLowerCase()}:${depDate.toLowerCase()}`;
}
export function reconciliationDidFor(flightNo: string, depDate: string): string {
  return `${AIR_DCS_DID_PREFIX}brec:${flightNo.toLowerCase()}:${depDate.toLowerCase()}`;
}
export function rkeyOf(prefix: string, id: string): string {
  return `${prefix}-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
