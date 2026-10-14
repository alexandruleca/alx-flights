import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AirportStore } from '../src/db/airport.store';
import { IngestStore } from '../src/db/ingest.store';
import type { MongoService } from '../src/db/mongo.service';
import { applyMessage, resumeFrom } from '../src/domain/apply';
import { AirportState } from '../src/domain/state';
import { timelineOf } from '../src/domain/timeline';
import type { FeedMessage } from '../src/domain/types';
import { flight, hello } from './fixtures';
import { throwawayMongo } from './mongo';

/** `HH:MM` on the fixtures' day, as ISO. */
const at = (hhmm: string) => `2026-10-13T${hhmm}:00.000Z`;

/** The fixture arrival, `delayMin` behind schedule, as of `hhmm`. */
const delayed = (hhmm: string, delayMin: number): FeedMessage => ({
  type: 'flight',
  seq: 2,
  ts: at(hhmm),
  ...flight({ delayMin }),
});

describe('alert log, as ingest stores it', () => {
  let db: Awaited<ReturnType<typeof throwawayMongo>>;
  let mongo: MongoService;
  let store: AirportStore;
  let writer: IngestStore;

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
  });
  afterEach(() => mongo.onModuleDestroy());

  it('keeps every raising of an alert that recurs, and a restart closes the open one', async () => {
    await ingestInto(new AirportState())(
      hello('ALX'),
      delayed('12:00', 30),
      delayed('12:05', 5),
      delayed('12:10', 40),
    );
    expect(await store.loadAlertLog(at('13:00'), 10)).toEqual([
      expect.objectContaining({ subject: 'delayed:X-1', raisedAt: at('12:10'), active: true }),
      expect.objectContaining({ subject: 'delayed:X-1', raisedAt: at('12:00'), closedAt: at('12:05') }),
    ]);

    const restarted = new AirportState();
    resumeFrom(restarted, await store.loadIngestMemory());
    await ingestInto(restarted)(hello('ALX'), delayed('12:15', 5));
    expect(await store.loadAlertLog(at('13:00'), 10)).toEqual([
      expect.objectContaining({ raisedAt: at('12:10'), closedAt: at('12:15') }),
      expect.objectContaining({ raisedAt: at('12:00'), closedAt: at('12:05') }),
    ]);
  });
});
