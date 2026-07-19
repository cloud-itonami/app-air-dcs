/**
 * air-dcs kotoba — barrel. kotoba-E2E split (plaintext flight-level operational
 * anchors + kotoba-E2E passenger PII / baggage / APIS-manifest payload,
 * ADR-2605181100). IATA-BSP fiat-clearing settlement EXECUTION for ticket fares
 * stays etzhayyim via consent-capability.
 */
export * from "./types.js";
export {
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
} from "./registry.js";
