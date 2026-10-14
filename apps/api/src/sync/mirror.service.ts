import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { ChangeStream, ChangeStreamDocument, Collection, Document } from 'mongodb';
import { AirportStore } from '../db/airport.store';
import { MongoService } from '../db/mongo.service';
import { isOutdated } from '../domain/state';
import type {
  AlertRecord,
  FeedLinkStatus,
  StoredAnomaly,
  StoredFlight,
  StoredPosition,
} from '../domain/types';
import { AirportEventsService } from '../events/airport-events.service';
import { AirportStateService } from '../state/airport-state.service';

const HYDRATE_ANOMALIES = 200;

/**
 * The API's copy of the airport: hydrated from Mongo once, then kept current
 * by change streams. Startup and live changes go through the same `put*` methods.
 */
@Injectable()
export class MirrorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MirrorService.name);
  private readonly streams: ChangeStream[] = [];
  /** Delete events carry only `_id`: remember which flight each document is. */
  private readonly flightIdByDocId = new Map<string, string>();

  constructor(
    private readonly mongo: MongoService,
    private readonly store: AirportStore,
    private readonly airportState: AirportStateService,
    private readonly events: AirportEventsService,
  ) {}

  private get state() {
    return this.airportState.state;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.hydrate();
    const collections = this.mongo.collections;
    this.follow(collections.meta, (doc) => this.putLink(doc));
    this.follow(
      collections.flights,
      (doc, id) => this.putFlight(doc, id),
      (id) => this.dropFlight(id),
    );
    this.follow(collections.positions, (doc) => this.putPosition(doc));
    this.follow(collections.alerts, (doc) => this.putAlert(doc));
    this.follow(collections.anomalies, (doc) => this.putAnomaly(doc));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.streams.map((s) => s.close().catch(() => undefined)));
  }

  private async hydrate(): Promise<void> {
    const [link, flights, alerts, anomalies] = await Promise.all([
      this.store.loadLink(),
      this.store.loadFlights(),
      this.store.loadOpenAlerts(),
      this.store.loadRecentAnomalies(HYDRATE_ANOMALIES),
    ]);
    const positions = await this.store.loadPositions(flights.map((f) => f.icao24));
    if (link) this.putLink(link);
    flights.forEach(({ _id, ...f }) => this.putFlight(f, _id));
    positions.forEach((p) => this.putPosition(p));
    alerts.forEach((a) => this.putAlert(a));
    anomalies.forEach((a) => this.putAnomaly(a));
    this.logger.log(
      `Hydrated ${flights.length} flights, ${positions.length} aircraft` +
        (link?.airport ? `, airport ${link.airport.code}` : ' (waiting for ingest hello)'),
    );
  }

  private putLink(status: FeedLinkStatus): void {
    this.state.importLink(status);
    this.events.changed('status', 'map');
  }

  private putFlight(flight: StoredFlight, docId: unknown): void {
    this.flightIdByDocId.set(String(docId), flight.flightId);
    this.state.flights.set(flight.flightId, flight);
    this.events.changed('board', 'map');
  }

  /** Ingest pruned a flight the latest snapshot no longer carries. */
  private dropFlight(docId: unknown): void {
    const flightId = this.flightIdByDocId.get(String(docId));
    if (!flightId) return;
    this.flightIdByDocId.delete(String(docId));
    this.state.flights.delete(flightId);
    this.events.changed('board', 'map');
  }

  private putPosition(position: StoredPosition): void {
    if (isOutdated(position, this.state.positions.get(position.icao24))) return;
    this.state.positions.set(position.icao24, position);
    this.events.changed('map');
  }

  private putAlert(alert: AlertRecord): void {
    this.state.alerts.set(alert.subject, alert);
    this.events.changed('alert');
  }

  private putAnomaly(anomaly: StoredAnomaly): void {
    this.airportState.anomalies.add(anomaly);
    this.events.changed('anomaly');
  }

  /**
   * Mirror one collection: inserts/updates carry the full document, deletes
   * only its `_id`. Mongo's `_id` stays here; the domain never sees it.
   */
  private follow<T extends Document>(
    collection: Collection<T>,
    put: (doc: T, id: unknown) => void,
    drop?: (id: unknown) => void,
  ): void {
    const name = collection.collectionName;
    const stream = collection.watch<T, ChangeStreamDocument<T>>([], {
      fullDocument: 'updateLookup',
    });
    stream.on('change', (change) => {
      try {
        if (change.operationType === 'delete') drop?.(change.documentKey._id);
        else if ('fullDocument' in change && change.fullDocument) {
          const { _id, ...doc } = change.fullDocument;
          put(doc as T, _id);
        }
      } catch (err) {
        this.logger.warn(`Mirror ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    stream.on('error', (err) => this.logger.error(`Change stream ${name}: ${err.message}`));
    this.streams.push(stream);
    this.logger.log(`Watching ${name}`);
  }
}
