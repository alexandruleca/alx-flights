import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MongoClient,
  type Collection,
  type CreateIndexesOptions,
  type Db,
  type IndexSpecification,
} from 'mongodb';
import type { AppConfig } from '../config/configuration';
import type {
  AlertRecord,
  FeedLinkStatus,
  MovementRecord,
  StandOccupancy,
  StoredAnomaly,
  StoredFlight,
  StoredPosition,
  TimelineEvent,
} from '../domain/types';

/** The single `meta` document: ingest's feed link, mirrored by the API. */
export interface LinkDoc extends FeedLinkStatus {
  _id: 'current';
  updatedAt: string;
}

/** Every collection, typed. Keys are the Mongo collection names. */
export interface Collections {
  meta: Collection<LinkDoc>;
  /** Current picture: one doc per flight the feed still carries. */
  flights: Collection<StoredFlight>;
  /** Append-only: every accepted flight change (replay). */
  flightVersions: Collection<StoredFlight>;
  /** Append-only position history. */
  positions: Collection<StoredPosition>;
  alerts: Collection<AlertRecord>;
  /** Idempotent landing / take-off log (Movements and on-time KPIs). */
  movements: Collection<MovementRecord>;
  /** One stay per arrival on its stand (stand utilisation KPI). */
  standOccupancy: Collection<StandOccupancy>;
  anomalies: Collection<StoredAnomaly>;
  /** Append-only timeline summaries (scrubber, replay event log). */
  events: Collection<TimelineEvent>;
}

type IndexList = [IndexSpecification, CreateIndexesOptions?][];

const INDEXES: { [K in keyof Collections]?: IndexList } = {
  flights: [[{ flightId: 1 }, { unique: true }]],
  flightVersions: [[{ ts: 1 }], [{ flightId: 1, ts: 1 }]],
  positions: [[{ ts: 1 }], [{ icao24: 1, ts: 1 }]],
  alerts: [[{ id: 1 }, { unique: true }], [{ raisedAt: -1 }]],
  movements: [[{ flightId: 1, kind: 1 }, { unique: true }], [{ ts: 1 }]],
  standOccupancy: [[{ flightId: 1 }, { unique: true }], [{ from: 1 }], [{ to: 1 }]],
  anomalies: [[{ at: -1 }]],
  events: [[{ ts: 1 }], [{ type: 1, ts: 1 }]],
};

const CONNECT_ATTEMPTS = 15;
const CONNECT_RETRY_MS = 1500;

/** Connection lifecycle and typed collections; queries live in the stores. */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private client?: MongoClient;
  private connectedCollections?: Collections;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get collections(): Collections {
    if (!this.connectedCollections) throw new Error('MongoService used before connecting');
    return this.connectedCollections;
  }

  async onModuleInit(): Promise<void> {
    const uri = this.config.get('mongodbUri', { infer: true });
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    for (let attempt = 1; ; attempt++) {
      try {
        await this.client.connect();
        break;
      } catch (err) {
        if (attempt === CONNECT_ATTEMPTS) throw err;
        this.logger.warn(
          `Mongo connect attempt ${attempt}/${CONNECT_ATTEMPTS} failed; is docker compose up (replica set)?`,
        );
        await new Promise((r) => setTimeout(r, CONNECT_RETRY_MS));
      }
    }
    this.connectedCollections = collectionsOf(this.client.db());
    await this.ensureIndexes();
    this.logger.log(`Connected to MongoDB ${uri}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  private async ensureIndexes(): Promise<void> {
    for (const [name, indexes] of Object.entries(INDEXES)) {
      const collection = this.collections[name as keyof Collections];
      for (const [spec, options] of indexes) {
        await collection.createIndex(spec, options);
      }
    }
  }
}

function collectionsOf(db: Db): Collections {
  return {
    meta: db.collection<LinkDoc>('meta'),
    flights: db.collection<StoredFlight>('flights'),
    flightVersions: db.collection<StoredFlight>('flightVersions'),
    positions: db.collection<StoredPosition>('positions'),
    alerts: db.collection<AlertRecord>('alerts'),
    movements: db.collection<MovementRecord>('movements'),
    standOccupancy: db.collection<StandOccupancy>('standOccupancy'),
    anomalies: db.collection<StoredAnomaly>('anomalies'),
    events: db.collection<TimelineEvent>('events'),
  };
}
