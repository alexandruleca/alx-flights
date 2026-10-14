/**
 * The wire contract between the API (apps/api) and the desk UI (apps/web).
 * Types only: both sides `import type` from here, so nothing in this file runs.
 */

// ---------- Feed vocabulary ----------

export type FlightKind = 'ARR' | 'DEP';

/** AIRBORNE → APPROACH → LANDED → TAXI → ON_STAND, or DIVERTED (never lands). */
export type ArrivalStatus =
  | 'AIRBORNE'
  | 'APPROACH'
  | 'LANDED'
  | 'TAXI'
  | 'ON_STAND'
  | 'DIVERTED';

/** SCHEDULED → BOARDING → PUSHBACK → TAXI → DEPARTED, or CANCELLED. */
export type DepartureStatus =
  | 'SCHEDULED'
  | 'BOARDING'
  | 'PUSHBACK'
  | 'TAXI'
  | 'DEPARTED'
  | 'CANCELLED';

export type FlightStatus = ArrivalStatus | DepartureStatus;

/** Where a status sits in the lifecycle. The API derives it; the UI colors by it. */
export type FlightPhase = 'planned' | 'active' | 'ground' | 'done' | 'irregular';

export interface AirportInfo {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export type ZoneKind = 'RUNWAY' | 'APRON' | 'APPROACH' | 'STAND';

/** GeoJSON zones from `hello`, typed just enough for our use. */
export interface Zones {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { kind: ZoneKind; name: string };
    geometry: { type: string; coordinates: unknown };
  }[];
}

/** A flight as the feed describes it. */
export interface FlightRecord {
  flightId: string;
  callsign: string;
  airline: string;
  reg: string;
  /** Transponder address; joins a flight to its aircraft's positions. */
  icao24: string;
  kind: FlightKind;
  origin: string;
  destination: string;
  /** For ARR these times refer to landing, for DEP to take-off. */
  scheduled: string;
  estimated: string;
  actual: string | null;
  status: FlightStatus;
  stand: string | null;
  runway: string;
}

/** One position report from a transmitting aircraft. */
export interface PositionRecord {
  icao24: string;
  callsign: string;
  lat: number;
  lon: number;
  alt: number;
  gs: number;
  track: number;
  onGround: boolean;
}

/** Where a stored version came from: feed time, message seq and feed connection. */
export interface Provenance {
  ts: string;
  seq: number;
  /** Bumps on every reconnect, because `seq` restarts at 1. */
  connectionEpoch: number;
}

export type StoredFlight = FlightRecord & Provenance;
export type StoredPosition = PositionRecord & Provenance;

// ---------- Live desk ----------

export interface BoardRow extends StoredFlight {
  phase: FlightPhase;
  /** The Delayed rule (see the API's domain/flight.ts). */
  delayed: boolean;
  /**
   * The other half of this aircraft's turnaround on the board: an arrival's
   * next departure, or a departure's inbound arrival (same `reg` / `icao24`).
   */
  turnaround: string | null;
  /** Involved in a stand conflict (either aircraft, arrival or departure). */
  standConflict: boolean;
}

export interface BoardPayload {
  arrivals: BoardRow[];
  departures: BoardRow[];
}

/**
 * An aircraft on the field, joined with the flight it is on now (`callsign` is
 * that flight's). Its position is the latest report.
 */
export interface MapAircraft extends StoredPosition {
  /** False = parked and silent: the feed stops reporting aircraft on stand. */
  transmitting: boolean;
  flightId: string | null;
  kind: FlightKind | null;
  status: FlightStatus | null;
  stand: string | null;
  origin: string | null;
  destination: string | null;
  delayed: boolean;
}

export interface MapPayload {
  airport: AirportInfo | null;
  zones: Zones | null;
  aircraft: MapAircraft[];
}

export type AlertType = 'delayed' | 'stand_conflict';

export interface AlertRecord {
  /** This raising of the alert, `<subject>@<raisedAt>`: raised again later, it is a new record. */
  id: string;
  /** What it is about, `delayed:<flightId>` or `stand:<stand>`: at most one open alert each. */
  subject: string;
  type: AlertType;
  /** The flight to act on: the delayed flight, or the arrival bound for an occupied stand. */
  flightId: string;
  message: string;
  /** Last change: raised, updated (new message) or cleared. */
  ts: string;
  active: boolean;
  raisedAt: string;
  closedAt: string | null;
}

/** GET /alerts/log — persisted alerts, open and closed, newest raised first. */
export interface AlertLogPayload {
  alerts: AlertRecord[];
}

/** Why the normalizer rejected a feed line. */
export type AnomalyReason =
  | 'invalid_json'
  | 'invalid_shape'
  | 'duplicate_seq'
  | 'bad_coords';

export interface Anomaly {
  id: string;
  at: string;
  reason: AnomalyReason;
  detail: string;
  seq?: number;
  raw?: string;
}

export interface AnomalyPayload {
  counts: Partial<Record<AnomalyReason, number>>;
  recent: Anomaly[];
}

export interface HealthPayload {
  ok: boolean;
  /** The feed's hello named a different airport than configured; ingest ignores it. */
  locked: boolean;
  error?: 'misconfigured' | 'starting';
  expected?: string;
  got?: string;
  airport?: AirportInfo;
  feed?: string;
  /** Feed reconnects since ingest started. */
  reconnects: number;
}

export interface HourMovements {
  /** Start of the UTC hour, ISO. */
  hour: string;
  landings: number;
  /** Landings no more than 15 min after schedule: on-time performance is this / `landings`. */
  onTimeLandings: number;
  takeoffs: number;
}

/** Minutes each stand was occupied (on-block to off-block) in one UTC hour. */
export interface HourStandUse {
  /** Start of the UTC hour, ISO. */
  hour: string;
  /** Stand → minutes occupied; a stand nobody was on is absent. */
  minutes: Record<string, number>;
}

/** GET /kpis — per UTC hour, oldest first; an hour with nothing to count is absent. */
export interface KpisPayload {
  /** Landings, take-offs and on-time performance, from the movement log. */
  movements: HourMovements[];
  standUse: HourStandUse[];
}

/**
 * GET /stream (server-sent events): topic → payload. Each topic carries the
 * same payload as its REST endpoint; the stream opens with every topic once.
 */
export interface DeskStream {
  status: HealthPayload;
  board: BoardPayload;
  map: MapPayload;
  alert: { alerts: AlertRecord[] };
  anomaly: AnomalyPayload;
}

export type DeskTopic = keyof DeskStream;

// ---------- History / replay ----------

export type TimelineEventType =
  | 'hello'
  | 'snapshot'
  | 'flight'
  | 'position'
  | 'movement'
  | 'anomaly'
  | 'alert';

/** One row of the append-only timeline: scrubber volume and the replay event log. */
export interface TimelineEvent {
  ts: string;
  type: TimelineEventType;
  connectionEpoch: number;
  seq?: number;
  summary: string;
  flightId?: string;
  icao24?: string;
  callsign?: string;
  status?: string;
  kind?: string;
  reason?: string;
}

/** GET /history/frame?at=T — the live desk payloads as they were at T. */
export interface FramePayload {
  at: string;
  board: BoardPayload;
  map: MapPayload;
  alerts: AlertRecord[];
  kpis: KpisPayload;
}

export interface VolumePoint {
  /** Bucket start, ISO. */
  start: string;
  count: number;
  byType: Partial<Record<TimelineEventType, number>>;
}

export interface VolumePayload {
  from: string;
  to: string;
  bucketSeconds: number;
  points: VolumePoint[];
}

/** A stored timeline row, with its identity. */
export interface TimelineEntry extends TimelineEvent {
  id: string;
}

export interface EventsPayload {
  from: string;
  to: string;
  total: number;
  events: TimelineEntry[];
}
