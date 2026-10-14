import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import type { EventsPayload, FramePayload, VolumePayload } from '@alx/contracts';
import { AirportStore } from '../db/airport.store';
import { TimelineStore } from '../db/timeline.store';
import { replayState } from '../domain/replay';
import { HOUR_MS, MINUTE_MS, SECOND_MS } from '../domain/time';
import { instant, rangeOf } from '../http/query';

const MAX_BUCKET_SECONDS = HOUR_MS / SECOND_MS;

/** Replay: the desk at a past instant, and the timeline to scrub through. */
@Controller('history')
export class HistoryController {
  constructor(
    private readonly airportStore: AirportStore,
    private readonly timelineStore: TimelineStore,
  ) {}

  /** The live desk payloads, rebuilt as they were at `at`. */
  @Get('frame')
  async frame(@Query('at') at?: string): Promise<FramePayload> {
    const atIso = instant(at, new Date());
    const [picture, kpis] = await Promise.all([
      this.airportStore.pictureAt(atIso),
      this.airportStore.kpis(atIso),
    ]);
    const state = replayState(picture);
    const atMs = Date.parse(atIso);
    return {
      at: atIso,
      board: state.board(atMs),
      map: state.mapView(atMs),
      alerts: state.activeAlerts(),
      kpis,
    };
  }

  @Get('volume')
  async volume(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('bucketSeconds', new DefaultValuePipe(0), ParseIntPipe) bucketSeconds = 0,
  ): Promise<VolumePayload> {
    const range = rangeOf(from, to);
    const bucket = Math.min(bucketSeconds > 0 ? bucketSeconds : autoBucket(range), MAX_BUCKET_SECONDS);
    const points = await this.timelineStore.volume(range.from, range.to, bucket);
    return { ...range, bucketSeconds: bucket, points };
  }

  @Get('events')
  async events(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('types') types?: string,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit = 500,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip = 0,
    @Query('order') order?: string,
  ): Promise<EventsPayload> {
    const range = rangeOf(from, to);
    const result = await this.timelineStore.events(range.from, range.to, {
      types: types?.split(',').map((t) => t.trim()).filter(Boolean),
      limit,
      skip,
      order: order === 'desc' ? 'desc' : 'asc',
    });
    return { ...range, ...result };
  }
}

/** ~120 bars whatever the span. */
function autoBucket(range: { from: string; to: string }): number {
  const minutes = (Date.parse(range.to) - Date.parse(range.from)) / MINUTE_MS;
  if (minutes <= 15) return 5;
  if (minutes <= 60) return 30;
  if (minutes <= 360) return 120;
  return 300;
}
