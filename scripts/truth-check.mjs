#!/usr/bin/env node
/**
 * Does the board match the feed?
 *
 * Opens its own connection to the CLEAN feed (same traffic as the realistic one,
 * well-formed), takes the feed's snapshot as ground truth and keeps it current for
 * a few seconds, then compares it with what the API serves from the REALISTIC feed:
 * every flight's status / stand / times, the Delayed alerts, the transmitting
 * aircraft within 15 km and their positions, the landing / take-off log (with the times the
 * on-time KPI compares), stand conflicts, and which aircraft are on a stand
 * (the stays the stand utilisation KPI adds up).
 *
 * The rules below are restated here on purpose instead of imported from apps/api:
 * a checker that reuses the code it checks cannot catch that code's bugs.
 *
 *   npm run truth-check                    # human summary; exit code 1 on mismatch
 *   npm run truth-check -- --json          # full report as JSON
 *   docker compose exec api npm run truth-check
 *
 * Env: API_URL, MONGODB_URI, TRUTH_FEED_URL (default: FEED_URL with /realistic/ → /clean/).
 */
import { MongoClient } from 'mongodb';

/** @typedef {import('@alx/contracts').FlightRecord & { ts: string }} TruthFlight */
/** @typedef {import('@alx/contracts').PositionRecord & { ts: string }} TruthPosition */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/alx?replicaSet=rs0';
const TRUTH_FEED_URL =
  process.env.TRUTH_FEED_URL ??
  (process.env.FEED_URL ?? 'https://rt-al-dev-generator.airportlabs.com/realistic/ndjson').replace(
    '/realistic/',
    '/clean/',
  );

/** Keep applying clean-feed messages this long after its snapshot. */
const LISTEN_MS = 15_000;
/** The realistic feed delivers some messages seconds late: truth this fresh may not have reached us. */
const LAG_MS = 8_000;
/** Beyond any feed delay: an aircraft this far off means the map is stuck. */
const POSITION_TOLERANCE_M = 3_000;

// ---------- The rules, restated independently of apps/api ----------

const PHASE = {
  AIRBORNE: 'planned', SCHEDULED: 'planned',
  APPROACH: 'active', BOARDING: 'active', PUSHBACK: 'active',
  LANDED: 'ground', TAXI: 'ground',
  ON_STAND: 'done', DEPARTED: 'done',
  DIVERTED: 'irregular', CANCELLED: 'irregular',
};
const SIGNAL_LOST_MS = 30_000;
const BOARD_HIDE_AFTER_MS = 20 * 60_000;
const DELAY_MS = 15 * 60_000;
const RANGE_M = 15_000;

/** Within 15 km (great circle) of the airport the hello announced: further out is not ours. */
const inRange = (position, airport) => {
  if (!airport) return false;
  const rad = Math.PI / 180;
  const h =
    Math.sin(((position.lat - airport.lat) * rad) / 2) ** 2 +
    Math.cos(position.lat * rad) *
      Math.cos(airport.lat * rad) *
      Math.sin(((position.lon - airport.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h)) <= RANGE_M;
};

/** The landing (ARR) or take-off (DEP) the schedule refers to has happened. */
const movementHappened = (flight) =>
  flight.kind === 'ARR'
    ? ['ground', 'done'].includes(PHASE[flight.status])
    : PHASE[flight.status] === 'done';
const isDelayed = (flight) =>
  PHASE[flight.status] !== 'irregular' &&
  !movementHappened(flight) &&
  Date.parse(flight.estimated) - Date.parse(flight.scheduled) > DELAY_MS;
/** Irregular flights never show; finished ones leave 20 min after finishing. */
const onBoard = (flight, now) =>
  PHASE[flight.status] !== 'irregular' &&
  !(
    PHASE[flight.status] === 'done' &&
    now - Date.parse(flight.actual ?? flight.ts) > BOARD_HIDE_AFTER_MS
  );
const movementKey = (flight) => `${flight.flightId}:${flight.kind === 'ARR' ? 'land' : 'takeoff'}`;

/** When a flight lands / takes off: an aircraft always lands before it departs again. */
const movementTime = (flight) => flight.actual ?? flight.estimated;
/**
 * Arrivals still holding their stand: status in `statuses`, and the departure their
 * aircraft flies next (if known) not yet pushing back.
 */
function holding(flights, statuses) {
  const byAircraft = new Map();
  for (const flight of flights) {
    byAircraft.set(flight.icao24, [...(byAircraft.get(flight.icao24) ?? []), flight]);
  }
  const arrivals = [];
  for (const rotation of byAircraft.values()) {
    rotation.sort((a, b) => movementTime(a).localeCompare(movementTime(b)));
    rotation.forEach((flight, index) => {
      if (flight.kind !== 'ARR' || !flight.stand || !statuses.includes(flight.status)) return;
      const next = rotation[index + 1];
      const vacating = ['PUSHBACK', 'TAXI', 'DEPARTED', 'CANCELLED'];
      if (next?.kind === 'DEP' && vacating.includes(next.status)) return;
      arrivals.push(flight);
    });
  }
  return arrivals;
}
/**
 * Stands two aircraft are on, or one is on while another has landed and is taxiing
 * to it. An aircraft holds its stand from landing until its departure pushes back.
 */
function conflictedStands(flights) {
  const holders = new Map();
  for (const arrival of holding(flights, ['LANDED', 'TAXI', 'ON_STAND'])) {
    holders.set(arrival.stand, new Set([...(holders.get(arrival.stand) ?? []), arrival.icao24]));
  }
  return new Set([...holders].filter(([, aircraft]) => aircraft.size > 1).map(([stand]) => stand));
}
/** Occupied: on its stand (ON_STAND) until its departure pushes back. */
const onStand = (flights) => holding(flights, ['ON_STAND']);

// ---------- 1. Ground truth: the clean feed's own picture ----------

async function readTruth() {
  /** @type {Map<string, TruthFlight>} */ const flights = new Map();
  /** @type {Map<string, TruthPosition>} */ const aircraft = new Map();
  /** When this check first heard each aircraft (snapshot time if the snapshot listed it). */
  const firstHeard = new Map();
  let airport = null;
  let snapshotAt = null;
  let now = 0;
  let stopAt = Infinity;

  const abort = new AbortController();
  const response = await fetch(TRUTH_FEED_URL, { signal: abort.signal });
  if (!response.ok || !response.body) throw new Error(`Truth feed HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (Date.now() < stopAt) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Truth feed ended before the check finished');
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('{')) continue;
        const message = JSON.parse(line);
        now = Math.max(now, Date.parse(message.ts));
        if (message.type === 'hello') {
          airport = message.airport;
        } else if (message.type === 'snapshot') {
          snapshotAt = message.ts;
          for (const flight of message.flights) {
            flights.set(flight.flightId, { ...flight, ts: message.ts });
          }
          for (const position of (message.aircraft ?? []).filter((p) => inRange(p, airport))) {
            aircraft.set(position.icao24, { ...position, ts: message.ts });
            firstHeard.set(position.icao24, Date.parse(message.ts));
          }
          stopAt = Date.now() + LISTEN_MS;
        } else if (message.type === 'flight' && snapshotAt) {
          flights.set(message.flightId, message);
        } else if (message.type === 'position' && snapshotAt && inRange(message, airport)) {
          aircraft.set(message.icao24, message);
          if (!firstHeard.has(message.icao24)) {
            firstHeard.set(message.icao24, Date.parse(message.ts));
          }
        }
      }
    }
  } finally {
    abort.abort();
  }
  return { snapshotAt, now, flights, aircraft, firstHeard };
}

// ---------- 2. What we serve (and what ingest has logged) ----------

async function readOurs() {
  const getJson = (path) => fetch(API_URL + path).then((response) => response.json());
  const mongo = await MongoClient.connect(MONGODB_URI);
  try {
    const db = mongo.db();
    const withoutId = { projection: { _id: 0 } };
    const [board, map, alerts, kpis, lastSnapshot, movements, openStays] = await Promise.all([
      getJson('/board'),
      getJson('/map'),
      getJson('/alerts'),
      getJson('/kpis'),
      db.collection('events').findOne({ type: 'snapshot' }, { sort: { ts: -1 } }),
      db.collection('movements').find({}, withoutId).toArray(),
      db.collection('standOccupancy').find({ to: null }, withoutId).toArray(),
    ]);
    return {
      board,
      map,
      alerts: alerts.alerts,
      kpis,
      lastIngestSnapshot: lastSnapshot?.ts ?? null,
      movements: new Map(movements.map((movement) => [`${movement.flightId}:${movement.kind}`, movement])),
      openStays,
    };
  } finally {
    await mongo.close();
  }
}

// ---------- 3. Compare ----------

function compare(truth, ours) {
  const { now } = truth;
  /** Real faults. */
  const issues = [];
  /** Truth changed seconds ago; the realistic feed hasn't delivered it to us yet. */
  const lagging = [];
  /** The feed retired a flight; we learn that at ingest's next snapshot. */
  const pendingRemoval = [];
  /** Left coverage < 30 s ago: still inside the map's signal-lost window. */
  const fading = [];
  const fresh = (ts) => now - Date.parse(ts) < LAG_MS;
  /** A mismatch is a fault, unless the truth behind it changed too recently to have reached us. */
  const flag = (truthTs, text) => (truthTs && fresh(truthTs) ? lagging : issues).push(text);

  // Board: same flights, same fields.
  const rows = new Map(
    [...ours.board.arrivals, ...ours.board.departures].map((row) => [row.flightId, row]),
  );
  const expected = [...truth.flights.values()].filter((flight) => onBoard(flight, now));
  for (const flight of expected) {
    const row = rows.get(flight.flightId);
    if (!row) {
      flag(flight.ts, `flight ${flight.callsign} (${flight.kind} ${flight.status}) missing from the board`);
      continue;
    }
    for (const field of ['status', 'stand', 'scheduled', 'estimated', 'actual']) {
      if ((row[field] ?? null) !== (flight[field] ?? null)) {
        flag(flight.ts, `${flight.callsign} ${field}: board ${row[field]}, feed ${flight[field]}`);
      }
    }
  }
  for (const row of rows.values()) {
    const flight = truth.flights.get(row.flightId);
    if (!flight) {
      const text = `${row.callsign} (${row.kind} ${row.status}) no longer in the feed`;
      (ours.lastIngestSnapshot > truth.snapshotAt ? issues : pendingRemoval).push(text);
    } else if (!onBoard(flight, now)) {
      flag(flight.ts, `${row.callsign} should have left the board (feed: ${flight.status})`);
    }
  }

  // Delayed alerts.
  const truthDelayed = [...truth.flights.values()].filter(isDelayed);
  const ourDelayed = new Set(
    ours.alerts.filter((alert) => alert.type === 'delayed').map((alert) => alert.flightId),
  );
  for (const flight of truthDelayed) {
    if (!ourDelayed.has(flight.flightId)) flag(flight.ts, `Delayed alert missing for ${flight.callsign}`);
  }
  for (const flightId of ourDelayed) {
    const flight = truth.flights.get(flightId);
    if (!flight || !isDelayed(flight)) {
      flag(flight?.ts, `Delayed alert raised for ${flight?.callsign ?? flightId}, feed says not delayed`);
    }
  }

  // Stand conflicts.
  const truthConflicts = conflictedStands([...truth.flights.values()]);
  const ourConflicts = new Set(
    ours.alerts
      .filter((alert) => alert.type === 'stand_conflict')
      .map((alert) => alert.subject.replace('stand:', '')),
  );
  const newestOnStand = (stand) =>
    [...truth.flights.values()]
      .filter((flight) => flight.stand === stand)
      .map((flight) => flight.ts)
      .sort()
      .pop();
  for (const stand of truthConflicts) {
    if (!ourConflicts.has(stand)) flag(newestOnStand(stand), `stand conflict on ${stand} not raised`);
  }
  for (const stand of ourConflicts) {
    if (!truthConflicts.has(stand)) {
      flag(newestOnStand(stand), `stand conflict on ${stand} raised, feed shows none`);
    }
  }

  // Map: transmitting = heard within 30 s.
  const truthTransmitting = [...truth.aircraft.values()].filter(
    (position) => now - Date.parse(position.ts) <= SIGNAL_LOST_MS,
  );
  const ourTransmitting = new Map(
    ours.map.aircraft
      .filter((aircraft) => aircraft.transmitting)
      .map((aircraft) => [aircraft.icao24, aircraft]),
  );
  const nearWindowEdge = (position) =>
    Math.abs(now - Date.parse(position.ts) - SIGNAL_LOST_MS) < 5_000;
  let maxOffsetM = 0;
  for (const position of truthTransmitting) {
    const aircraft = ourTransmitting.get(position.icao24);
    if (!aircraft) {
      // Just came in range, or about to time out: timing, not a fault.
      const justHeard = now - truth.firstHeard.get(position.icao24) < LAG_MS;
      (justHeard || nearWindowEdge(position) ? lagging : issues).push(
        `aircraft ${position.callsign} (${position.icao24}) missing from the map`,
      );
      continue;
    }
    const offsetM = Math.hypot(
      (aircraft.lat - position.lat) * 111_000,
      (aircraft.lon - position.lon) * 85_000,
    );
    maxOffsetM = Math.max(maxOffsetM, offsetM);
    if (offsetM > POSITION_TOLERANCE_M) {
      issues.push(`${position.callsign} is ${Math.round(offsetM)} m off`);
    }
  }
  const truthTransmittingIds = new Set(truthTransmitting.map((position) => position.icao24));
  for (const aircraft of ourTransmitting.values()) {
    if (truthTransmittingIds.has(aircraft.icao24)) continue;
    const heardByTruth = truth.aircraft.get(aircraft.icao24);
    if (!heardByTruth && now - Date.parse(aircraft.ts) <= SIGNAL_LOST_MS) {
      fading.push(`${aircraft.callsign} (${aircraft.icao24}) last heard ${aircraft.ts.slice(11, 19)}`);
    } else {
      (heardByTruth && nearWindowEdge(heardByTruth) ? lagging : issues).push(
        `aircraft ${aircraft.callsign} (${aircraft.icao24}) on the map but not transmitting`,
      );
    }
  }

  // Movements: everything the feed shows as landed / departed must be in our log,
  // at the time it happened and with its schedule (what on-time performance compares).
  const moved = [...truth.flights.values()].filter(movementHappened);
  for (const flight of moved) {
    const what = `${flight.callsign} ${flight.kind === 'ARR' ? 'landing' : 'take-off'}`;
    const logged = ours.movements.get(movementKey(flight));
    if (!logged) flag(flight.ts, `${what} not logged`);
    else if (logged.ts !== flight.actual || logged.scheduled !== flight.scheduled) {
      issues.push(
        `${what} logged at ${logged.ts} (scheduled ${logged.scheduled}), ` +
          `feed ${flight.actual} (scheduled ${flight.scheduled})`,
      );
    }
  }
  const hour = new Date(now).toISOString().slice(0, 13);
  const ourHour = ours.kpis.movements.find((row) => row.hour.startsWith(hour)) ?? {
    landings: 0,
    takeoffs: 0,
  };

  // Stand occupancy: the stays still open are exactly the aircraft on a stand now.
  const truthOnStand = onStand([...truth.flights.values()]);
  const openStays = new Map(ours.openStays.map((stay) => [stay.flightId, stay]));
  const newestOfAircraft = (icao24) =>
    [...truth.flights.values()]
      .filter((flight) => flight.icao24 === icao24)
      .map((flight) => flight.ts)
      .sort()
      .pop();
  for (const arrival of truthOnStand) {
    const stay = openStays.get(arrival.flightId);
    if (!stay) flag(arrival.ts, `${arrival.callsign} on stand ${arrival.stand}, no open stand occupancy`);
    else if (stay.stand !== arrival.stand) {
      issues.push(`${arrival.callsign} occupies ${stay.stand}, feed says ${arrival.stand}`);
    }
  }
  const truthOnStandIds = new Set(truthOnStand.map((arrival) => arrival.flightId));
  for (const stay of openStays.values()) {
    if (truthOnStandIds.has(stay.flightId)) continue;
    const arrival = truth.flights.get(stay.flightId);
    if (!arrival) {
      const text = `${stay.flightId} still occupying ${stay.stand}, no longer in the feed`;
      (ours.lastIngestSnapshot > truth.snapshotAt ? issues : pendingRemoval).push(text);
    } else {
      flag(
        newestOfAircraft(arrival.icao24),
        `${arrival.callsign} still occupying ${stay.stand}, feed shows it off the stand`,
      );
    }
  }
  const movedThisHour = (kind) =>
    moved.filter((flight) => flight.kind === kind && (flight.actual ?? '').startsWith(hour)).length;

  return {
    feedClock: new Date(now).toISOString(),
    truthSnapshot: truth.snapshotAt,
    ingestSnapshot: ours.lastIngestSnapshot,
    flights: { feed: expected.length, board: rows.size },
    delayed: { feed: truthDelayed.length, board: ourDelayed.size },
    standConflicts: { feed: [...truthConflicts], board: [...ourConflicts] },
    transmitting: { feed: truthTransmitting.length, map: ourTransmitting.size },
    parked: ours.map.aircraft
      .filter((aircraft) => !aircraft.transmitting)
      .map((aircraft) => `${aircraft.callsign}@${aircraft.stand}`),
    maxPositionOffsetM: Math.round(maxOffsetM),
    onStand: { feed: truthOnStand.length, ingest: openStays.size },
    movements: {
      logged: moved.length,
      thisHour: {
        board: { landings: ourHour.landings, takeoffs: ourHour.takeoffs },
        feedAtLeast: { landings: movedThisHour('ARR'), takeoffs: movedThisHour('DEP') },
      },
    },
    verdict: issues.length ? 'MISMATCH' : 'TRUTHFUL',
    issues,
    lagging,
    pendingRemoval,
    fading,
  };
}

// ---------- 4. Report ----------

function printSummary(report) {
  const mark = (feed, ours) => (feed === ours ? '✓' : '✗');
  const { flights, delayed, standConflicts, transmitting, onStand, movements } = report;
  const { thisHour } = movements;
  const lines = [
    `Truth check at ${report.feedClock.slice(11, 19)} UTC (feed clock)`,
    `  truth snapshot ${report.truthSnapshot?.slice(11, 19)} · ingest's last snapshot ${report.ingestSnapshot?.slice(11, 19)}`,
    `  flights on board   feed ${flights.feed} / board ${flights.board}`,
    `  delayed alerts     feed ${delayed.feed} / board ${delayed.board}  ${mark(delayed.feed, delayed.board)}`,
    `  stand conflicts    feed ${standConflicts.feed.join(', ') || 'none'} / board ${standConflicts.board.join(', ') || 'none'}  ${mark(standConflicts.feed.sort().join(), standConflicts.board.sort().join())}`,
    `  transmitting       feed ${transmitting.feed} / map ${transmitting.map}  ${mark(transmitting.feed, transmitting.map)}  (max position offset ${report.maxPositionOffsetM} m)`,
    `  parked (map only)  ${report.parked.join(', ') || '—'}`,
    `  on a stand         feed ${onStand.feed} / open stays ${onStand.ingest}  ${mark(onStand.feed, onStand.ingest)}`,
    `  movements          all ${movements.logged} the feed shows checked against the log (times, schedule); this hour board ${thisHour.board.landings} landings / ${thisHour.board.takeoffs} take-offs (feed shows ≥ ${thisHour.feedAtLeast.landings} / ≥ ${thisHour.feedAtLeast.takeoffs})`,
  ];
  const section = (title, items) =>
    items.length && lines.push(`  ${title}:`, ...items.map((item) => `    - ${item}`));
  section('ISSUES', report.issues);
  section('lagging (feed changed seconds ago, not a fault)', report.lagging);
  section('pending removal (feed retired it; pruned at the next snapshot)', report.pendingRemoval);
  section('fading (left coverage < 30 s ago)', report.fading);
  lines.push(`  VERDICT: ${report.verdict}`);
  console.log(lines.join('\n'));
}

const truth = await readTruth();
const ours = await readOurs();
const report = compare(truth, ours);
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else printSummary(report);
process.exitCode = report.verdict === 'TRUTHFUL' ? 0 : 1;
