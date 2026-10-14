import type {
  AirportInfo,
  AlertRecord,
  Anomaly,
  FlightRecord,
  PositionRecord,
  Zones,
} from '@alx/contracts';

/** Shapes shared with the web desk live in the contract package. */
export type {
  AirportInfo,
  AlertRecord,
  Anomaly,
  AnomalyReason,
  BoardRow,
  FlightPhase,
  FlightRecord,
  FlightStatus,
  HealthPayload,
  MapAircraft,
  PositionRecord,
  StoredFlight,
  StoredPosition,
  TimelineEvent,
  Zones,
} from '@alx/contracts';

// ---------- Feed messages (one JSON object per NDJSON line) ----------

interface Envelope<T extends string> {
  type: T;
  /** Message number on this connection; restarts at 1 on reconnect. */
  seq: number;
  ts: string;
}

export interface HelloMessage extends Envelope<'hello'> {
  feed: string;
  airport: AirportInfo;
  zones: Zones;
}

export interface SnapshotMessage extends Envelope<'snapshot'> {
  /** Every flight still in the feed: anything missing has left. */
  flights: FlightRecord[];
  aircraft?: PositionRecord[];
}

export type FlightMessage = Envelope<'flight'> & FlightRecord;
export type PositionMessage = Envelope<'position'> & PositionRecord;

export type FeedMessage =
  | HelloMessage
  | SnapshotMessage
  | FlightMessage
  | PositionMessage;

// ---------- Ingest records ----------

export interface MovementRecord {
  flightId: string;
  kind: 'land' | 'takeoff';
  ts: string;
  /** When it was scheduled to happen: on-time performance compares the two. */
  scheduled: string;
  connectionEpoch: number;
}

/** One aircraft's stay on a stand: one per arrival, from on-block to off-block. */
export interface StandOccupancy {
  /** The arrival that brought the aircraft onto the stand. */
  flightId: string;
  stand: string;
  /** On-block: first seen on the stand. */
  from: string;
  /**
   * Off-block: its departure started pushing back, or it left the feed. If that
   * happened while ingest was not connected, the last time it heard the feed.
   * Null while on stand.
   */
  to: string | null;
}

/** What earlier ingest runs recorded, reloaded on restart so it can close what they opened. */
export interface IngestMemory {
  /** Alerts still open when the last run stopped. */
  alerts: AlertRecord[];
  movements: MovementRecord[];
  /** Stays still open: aircraft on a stand when the last run stopped. */
  onStand: StandOccupancy[];
  /** Feed time of the newest message the last run applied; null on a first start. */
  heardAt: string | null;
}

export type StoredAnomaly = Anomaly & { connectionEpoch: number };

/** Set when hello names another airport than configured: the feed is ignored. */
export interface FeedLock {
  expected: string;
  got: string;
}

/** What ingest publishes about its feed connection (the `meta` document). */
export interface FeedLinkStatus {
  airport: AirportInfo | null;
  zones: Zones | null;
  feed: string | null;
  connectionEpoch: number;
  lock: FeedLock | null;
}
