import { Injectable } from '@nestjs/common';
import type { Collection, Document, Filter, WithId } from 'mongodb';
import type { HourMovements, HourStandUse, KpisPayload } from '@alx/contracts';
import { DELAY_THRESHOLD_MS } from '../domain/flight';
import { standUsePerHour } from '../domain/occupancy';
import type { Picture } from '../domain/replay';
import { SIGNAL_LOST_MS } from '../domain/state';
import { HOUR_MS, startOfHour } from '../domain/time';
import type {
  AlertRecord,
  IngestMemory,
  StoredAnomaly,
  StoredFlight,
  StoredPosition,
} from '../domain/types';
import { MongoService, type LinkDoc } from './mongo.service';

/** The desk's KPIs cover this many UTC clock hours, the current one included. */
const KPI_HOURS = 6;

/** Reads of the airport picture: as it is now (API hydrate, ingest resume) or was at T (replay). */
@Injectable()
export class AirportStore {
  constructor(private readonly mongo: MongoService) {}

  private get collections() {
    return this.mongo.collections;
  }

  loadLink(): Promise<LinkDoc | null> {
    return this.collections.meta.findOne({ _id: 'current' });
  }

  /** With `_id`: the mirror maps change-stream deletes (which carry only `_id`) back to flights. */
  loadFlights(): Promise<WithId<StoredFlight>[]> {
    return this.collections.flights.find().toArray();
  }

  /** Open alerts: one per subject. Closed ones are only read back by the log. */
  loadOpenAlerts(): Promise<AlertRecord[]> {
    return this.collections.alerts.find({ active: true }, { projection: { _id: 0 } }).toArray();
  }

  /** Persisted alerts raised at or before `untilIso`, open and closed, newest raised first. */
  loadAlertLog(untilIso: string, limit: number): Promise<AlertRecord[]> {
    return this.collections.alerts
      .find({ raisedAt: { $lte: untilIso } }, { projection: { _id: 0 }, sort: { raisedAt: -1 }, limit })
      .toArray();
  }

  /** What earlier ingest runs recorded, for a restarted ingest to pick up from. */
  async loadIngestMemory(): Promise<IngestMemory> {
    const withoutId = { projection: { _id: 0 } };
    const [alerts, movements, onStand, newestFeedMessage] = await Promise.all([
      this.loadOpenAlerts(),
      this.collections.movements.find({}, withoutId).toArray(),
      this.collections.standOccupancy.find({ to: null }, withoutId).toArray(),
      // The newest feed message applied. Anomaly rows carry the wall clock, not feed time.
      this.collections.events.findOne(
        { type: { $in: ['snapshot', 'flight', 'position'] } },
        { sort: { ts: -1 }, projection: { ts: 1 } },
      ),
    ]);
    return { alerts, movements, onStand, heardAt: newestFeedMessage?.ts ?? null };
  }

  /** Oldest first, so they replay into an AnomalyLog in order. */
  async loadRecentAnomalies(limit: number): Promise<StoredAnomaly[]> {
    const newestFirst = await this.collections.anomalies
      .find({}, { projection: { _id: 0 }, sort: { at: -1 }, limit })
      .toArray();
    return newestFirst.reverse();
  }

  /** Aircraft positions as of the newest report, for the given airframes (see positionsAt). */
  async loadPositions(airframes: string[]): Promise<StoredPosition[]> {
    const newest = await this.collections.positions.findOne({}, { sort: { ts: -1 } });
    return newest ? this.positionsAt(newest.ts, airframes) : [];
  }

  /**
   * Latest version of every flight and transmitting aircraft at `atIso`.
   * Flights count from the last snapshot before it, which resets the picture
   * exactly as it does in ingest.
   */
  async pictureAt(atIso: string): Promise<Picture> {
    const [link, snapshot] = await Promise.all([
      this.loadLink(),
      this.collections.events.findOne(
        { type: 'snapshot', ts: { $lte: atIso } },
        { sort: { ts: -1 } },
      ),
    ]);
    const flights = await latestPerKey(this.collections.flightVersions, 'flightId', {
      ts: { ...(snapshot && { $gte: snapshot.ts }), $lte: atIso },
    });
    const positions = await this.positionsAt(atIso, flights.map((f) => f.icao24));
    return { link, flights, positions };
  }

  /** The KPIs per UTC hour, for the last `KPI_HOURS` clock hours up to `untilIso`. */
  async kpis(untilIso = new Date().toISOString()): Promise<KpisPayload> {
    const hourStart = startOfHour(Date.parse(untilIso));
    const sinceIso = new Date(hourStart - (KPI_HOURS - 1) * HOUR_MS).toISOString();
    const [movements, standUse] = await Promise.all([
      this.movementsPerHour(sinceIso, untilIso),
      this.standUse(sinceIso, untilIso),
    ]);
    return { movements, standUse };
  }

  /** Landings (and how many were on time) and take-offs per UTC hour. */
  private async movementsPerHour(sinceIso: string, untilIso: string): Promise<HourMovements[]> {
    const landing = { $eq: ['$kind', 'land'] };
    // On time: landed no more than the Delayed threshold after schedule.
    const onTime = {
      $lte: [{ $subtract: [{ $toDate: '$ts' }, { $toDate: '$scheduled' }] }, DELAY_THRESHOLD_MS],
    };
    const rows = await this.collections.movements
      .aggregate<{ _id: Date; landings: number; onTimeLandings: number; takeoffs: number }>([
        { $match: { ts: { $gte: sinceIso, $lte: untilIso } } },
        {
          $group: {
            _id: { $dateTrunc: { date: { $toDate: '$ts' }, unit: 'hour' } },
            landings: { $sum: { $cond: [landing, 1, 0] } },
            onTimeLandings: { $sum: { $cond: [{ $and: [landing, onTime] }, 1, 0] } },
            takeoffs: { $sum: { $cond: [{ $eq: ['$kind', 'takeoff'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    return rows.map((row) => ({
      hour: row._id.toISOString(),
      landings: row.landings,
      onTimeLandings: row.onTimeLandings,
      takeoffs: row.takeoffs,
    }));
  }

  /** Minutes each stand was occupied per UTC hour, from the stays overlapping the window. */
  private async standUse(sinceIso: string, untilIso: string): Promise<HourStandUse[]> {
    const stays = await this.collections.standOccupancy
      .find(
        { from: { $lte: untilIso }, $or: [{ to: null }, { to: { $gte: sinceIso } }] },
        { projection: { _id: 0 } },
      )
      .toArray();
    return standUsePerHour(stays, sinceIso, untilIso);
  }

  /**
   * Latest report per aircraft at `atIso`: everything heard within the signal
   * window, plus the last word of each tracked airframe — a parked aircraft is
   * silent, so its last report can be minutes old.
   */
  private async positionsAt(atIso: string, airframes: string[]): Promise<StoredPosition[]> {
    const from = new Date(Date.parse(atIso) - SIGNAL_LOST_MS).toISOString();
    const [tracked, heard] = await Promise.all([
      latestPerKey(this.collections.positions, 'icao24', {
        icao24: { $in: airframes },
        ts: { $lte: atIso },
      }),
      latestPerKey(this.collections.positions, 'icao24', { ts: { $gte: from, $lte: atIso } }),
    ]);
    return [...new Map([...tracked, ...heard].map((p) => [p.icao24, p])).values()];
  }
}

/** The newest document (by `ts`) per `key` among those matching `filter`. */
function latestPerKey<T extends Document>(
  collection: Collection<T>,
  key: keyof T & string,
  filter: Filter<T>,
): Promise<T[]> {
  return collection
    .aggregate<T>([
      { $match: filter },
      // Matches the { key, ts } indexes (walked backwards), newest first per key.
      { $sort: { [key]: -1, ts: -1 } },
      { $group: { _id: `$${key}`, doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $project: { _id: 0 } },
    ])
    .toArray();
}
