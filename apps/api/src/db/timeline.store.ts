import { Injectable } from '@nestjs/common';
import type { Filter } from 'mongodb';
import type { EventsPayload, VolumePoint } from '@alx/contracts';
import type { TimelineEvent } from '../domain/types';
import { MongoService } from './mongo.service';

export interface EventsQuery {
  types?: string[];
  limit: number;
  skip: number;
  order: 'asc' | 'desc';
}

const MAX_EVENTS = 2000;

/** Reads of the append-only timeline: scrubber volume and the replay event log. */
@Injectable()
export class TimelineStore {
  constructor(private readonly mongo: MongoService) {}

  /** Event counts per `bucketSeconds` bucket, split by event type. */
  async volume(fromIso: string, toIso: string, bucketSeconds: number): Promise<VolumePoint[]> {
    const rows = await this.mongo.collections.events
      .aggregate<{ _id: Date; count: number; byType: VolumePoint['byType'] }>([
        { $match: { ts: { $gte: fromIso, $lte: toIso } } },
        {
          $group: {
            _id: {
              bucketStart: {
                $dateTrunc: {
                  date: { $toDate: '$ts' },
                  unit: 'second',
                  binSize: bucketSeconds,
                },
              },
              type: '$type',
            },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: '$_id.bucketStart',
            count: { $sum: '$count' },
            // `k` / `v` are the field names $arrayToObject requires.
            byType: { $push: { k: '$_id.type', v: '$count' } },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { count: 1, byType: { $arrayToObject: '$byType' } } },
      ])
      .toArray();
    return rows.map((row) => ({
      start: row._id.toISOString(),
      count: row.count,
      byType: row.byType,
    }));
  }

  async events(
    fromIso: string,
    toIso: string,
    query: EventsQuery,
  ): Promise<Omit<EventsPayload, 'from' | 'to'>> {
    const filter: Filter<TimelineEvent> = { ts: { $gte: fromIso, $lte: toIso } };
    if (query.types?.length) filter.type = { $in: query.types as TimelineEvent['type'][] };
    const events = this.mongo.collections.events;
    const [total, rows] = await Promise.all([
      events.countDocuments(filter),
      events
        .find(filter)
        .sort({ ts: query.order === 'desc' ? -1 : 1 })
        .skip(query.skip)
        .limit(Math.min(query.limit, MAX_EVENTS))
        .toArray(),
    ]);
    return {
      total,
      events: rows.map(({ _id, ...event }) => ({ ...event, id: _id.toHexString() })),
    };
  }
}
