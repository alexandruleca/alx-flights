import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AirportStore } from '../src/db/airport.store';
import { IngestStore } from '../src/db/ingest.store';
import type { MongoService } from '../src/db/mongo.service';
import { makeAnomaly } from '../src/domain/anomalies';
import { applyMessage, resumeFrom } from '../src/domain/apply';
import { AirportState } from '../src/domain/state';
import { anomalyEvent, timelineOf } from '../src/domain/timeline';
import type { FeedMessage, FlightRecord, FlightStatus } from '../src/domain/types';
import { flight, hello, position } from './fixtures';
import { throwawayMongo } from './mongo';

/** `HH:MM` on the fixtures' day, as ISO. */
const at = (hhmm: string) => `2026-10-13T${hhmm}:00.000Z`;

const snapshot = (ts: string, flights: FlightRecord[]): FeedMessage => ({
  type: 'snapshot',
  seq: 2,
  ts,
  flights,
});
const update = (ts: string, record: FlightRecord): FeedMessage => ({
  type: 'flight',
  seq: 3,
  ts,
  ...record,
});

/** An arrival scheduled at `scheduled` that landed at `landed`, now taxiing in. */
const landed = (id: string, scheduled: string, landedAt: string) =>
  flight({
    flightId: id,
    icao24: id,
    status: 'TAXI',
    scheduled: at(scheduled),
    estimated: at(landedAt),
    actual: at(landedAt),
  });
const departed = (id: string, scheduled: string, departedAt: string) =>
  flight({
    flightId: id,
    icao24: id,
    kind: 'DEP',
    status: 'DEPARTED',
    scheduled: at(scheduled),
    estimated: at(departedAt),
    actual: at(departedAt),
  });

/** One aircraft's turnaround on `stand`: arrival `<id>-ARR` landing at `lands`, then `<id>-DEP`. */
const arrival = (id: string, stand: string, status: FlightStatus, lands: string) =>
  flight({
    flightId: `${id}-ARR`,
    icao24: id,
    stand,
    status,
    scheduled: at(lands),
    estimated: at(lands),
    actual: status === 'APPROACH' ? null : at(lands),
  });
const departure = (id: string, stand: string, status: FlightStatus) =>
  flight({
    flightId: `${id}-DEP`,
    icao24: id,
    kind: 'DEP',
    stand,
    status,
    scheduled: at('13:00'),
    estimated: at('13:00'),
  });

describe('KPIs, as ingest stores them and the desk reads them', () => {
  let db: Awaited<ReturnType<typeof throwawayMongo>>;
  let mongo: MongoService;
  let store: AirportStore;
  let writer: IngestStore;
  let ingest: (...messages: FeedMessage[]) => Promise<void>;

  /** Ingest without the feed connection: apply each message, persist what it changed. */
  const ingestInto =
    (state: AirportState) =>
    async (...messages: FeedMessage[]): Promise<void> => {
      for (const message of messages) {
        const effects = applyMessage(state, message, 'ALX');
        await writer.persist(effects, timelineOf(message, effects, state));
      }
    };

  // The first run downloads MongoDB.
  beforeAll(async () => {
    db = await throwawayMongo();
  }, 120_000);
  afterAll(() => db?.stop());

  beforeEach(async () => {
    mongo = await db.connect();
    store = new AirportStore(mongo);
    writer = new IngestStore(mongo);
    ingest = ingestInto(new AirportState());
    await ingest(hello('ALX'));
  });
  afterEach(() => mongo.onModuleDestroy());

  it('counts a landing as on time up to 15 min after schedule, in the hour it landed', async () => {
    await ingest(
      snapshot(at('12:30'), [
        landed('EARLY', '12:10', '12:00'),
        landed('EDGE', '12:00', '12:15'),
        landed('LATE', '12:00', '12:16'),
        landed('BEFORE', '11:00', '11:40'),
        departed('OUT', '12:05', '12:20'),
      ]),
    );
    expect((await store.kpis(at('12:30'))).movements).toEqual([
      { hour: at('11:00'), landings: 1, onTimeLandings: 0, takeoffs: 0 },
      { hour: at('12:00'), landings: 3, onTimeLandings: 2, takeoffs: 1 },
    ]);
  });

  it('covers the last six whole clock hours', async () => {
    await ingest(
      snapshot(at('12:30'), [landed('TOO-OLD', '06:59', '06:59'), landed('OLDEST', '07:00', '07:00')]),
    );
    expect((await store.kpis(at('12:30'))).movements.map((h) => h.hour)).toEqual([at('07:00')]);
  });

  /** EK on A3 from 11:55 to 12:10; LH on A5 from 12:20, still there when last heard at 12:25. */
  async function twoTurnarounds(): Promise<void> {
    await ingest(
      snapshot(at('11:50'), [
        arrival('EK', 'A3', 'TAXI', '11:45'),
        departure('EK', 'A3', 'SCHEDULED'),
        arrival('LH', 'A5', 'APPROACH', '12:15'),
        departure('LH', 'A5', 'SCHEDULED'),
      ]),
      update(at('11:55'), arrival('EK', 'A3', 'ON_STAND', '11:45')),
      update(at('12:10'), departure('EK', 'A3', 'PUSHBACK')),
      update(at('12:20'), arrival('LH', 'A5', 'ON_STAND', '12:15')),
      { type: 'position', seq: 4, ts: at('12:25'), ...position({ icao24: 'XX' }) },
    );
  }

  it('adds up the minutes each stand was occupied, per hour', async () => {
    await twoTurnarounds();
    expect((await store.kpis(at('12:30'))).standUse).toEqual([
      { hour: at('11:00'), minutes: { A3: 5 } },
      { hour: at('12:00'), minutes: { A3: 10, A5: 10 } },
    ]);
    // One record per stay, closed in place: only LH is still on its stand for a restart to resume.
    expect((await store.loadIngestMemory()).onStand).toEqual([
      { flightId: 'LH-ARR', stand: 'A5', from: at('12:20'), to: null },
    ]);
  });

  it('after a restart, ends a stay that ended while ingest was down when it last heard the feed', async () => {
    await twoTurnarounds();
    // A line rejected after the last message: the feed's garbage, stamped with the wall clock.
    const anomaly = { ...makeAnomaly('invalid_json', 'truncated'), connectionEpoch: 1 };
    await writer.recordAnomaly(anomaly, anomalyEvent(anomaly));

    // Ingest is down until 14:00; when it comes back, LH has left the feed.
    const restarted = new AirportState();
    resumeFrom(restarted, await store.loadIngestMemory());
    await ingestInto(restarted)(hello('ALX'), snapshot(at('14:00'), []));

    expect((await store.kpis(at('14:30'))).standUse).toEqual([
      { hour: at('11:00'), minutes: { A3: 5 } },
      { hour: at('12:00'), minutes: { A3: 10, A5: 5 } },
    ]);
    expect((await store.loadIngestMemory()).onStand).toEqual([]);
  });

  it('reads them as they were at an earlier instant (replay)', async () => {
    await twoTurnarounds();
    const kpis = await store.kpis(at('12:05'));
    // EK's stay is cut at the cursor; LH had neither landed nor reached its stand yet.
    expect(kpis.standUse).toEqual([
      { hour: at('11:00'), minutes: { A3: 5 } },
      { hour: at('12:00'), minutes: { A3: 5 } },
    ]);
    expect(kpis.movements).toEqual([
      { hour: at('11:00'), landings: 1, onTimeLandings: 1, takeoffs: 0 },
    ]);
  });
});
