import { Injectable } from '@nestjs/common';
import type {
  AnyBulkWriteOperation,
  Collection,
  Document,
  Filter,
  OptionalUnlessRequiredId,
} from 'mongodb';
import type { ApplyEffects } from '../domain/apply';
import type { FeedLinkStatus, StoredAnomaly, TimelineEvent } from '../domain/types';
import { MongoService } from './mongo.service';

/** Everything ingest writes. Only the ingest process uses it. */
@Injectable()
export class IngestStore {
  constructor(private readonly mongo: MongoService) {}

  async saveLink(link: FeedLinkStatus, at: string): Promise<void> {
    await this.mongo.collections.meta.updateOne(
      { _id: 'current' },
      { $set: { ...link, updatedAt: at } },
      { upsert: true },
    );
  }

  /** One applied message: current state, the version logs and the timeline. */
  async persist(effects: ApplyEffects, timeline: TimelineEvent[]): Promise<void> {
    const collections = this.mongo.collections;
    const flightIds = effects.flights.map((f) => f.flightId);
    await Promise.all([
      upsertAll(collections.flights, ['flightId'], effects.flights),
      insertAll(collections.flightVersions, effects.flights),
      // A snapshot is the feed's full list: flights it no longer carries have left.
      effects.flightListComplete &&
        collections.flights.deleteMany({ flightId: { $nin: flightIds } }),
      insertAll(collections.positions, effects.positions),
      upsertAll(collections.alerts, ['id'], effects.alerts),
      upsertAll(collections.movements, ['flightId', 'kind'], effects.movements),
      upsertAll(collections.standOccupancy, ['flightId'], effects.occupancies),
      insertAll(collections.events, timeline),
    ]);
  }

  async recordAnomaly(anomaly: StoredAnomaly, event: TimelineEvent): Promise<void> {
    const collections = this.mongo.collections;
    await Promise.all([
      insertAll(collections.anomalies, [anomaly]),
      insertAll(collections.events, [event]),
    ]);
  }
}

/** Insert copies: the driver stamps `_id` onto what it inserts; domain objects stay clean. */
async function insertAll<T extends Document>(collection: Collection<T>, docs: T[]): Promise<void> {
  if (!docs.length) return;
  const copies = docs.map((doc) => ({ ...doc }) as OptionalUnlessRequiredId<T>);
  await collection.insertMany(copies, { ordered: false });
}

/** Upsert each doc by its natural key. */
async function upsertAll<T extends Document>(
  collection: Collection<T>,
  keyFields: (keyof T & string)[],
  docs: T[],
): Promise<void> {
  if (!docs.length) return;
  const operations = docs.map(
    (doc): AnyBulkWriteOperation<T> => ({
      updateOne: {
        filter: Object.fromEntries(keyFields.map((field) => [field, doc[field]])) as Filter<T>,
        update: { $set: doc },
        upsert: true,
      },
    }),
  );
  await collection.bulkWrite(operations, { ordered: false });
}
