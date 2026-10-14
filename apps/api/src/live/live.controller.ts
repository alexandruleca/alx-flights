import {
  Controller,
  DefaultValuePipe,
  Get,
  MessageEvent,
  ParseIntPipe,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable, from, map, merge } from 'rxjs';
import type {
  AlertLogPayload,
  DeskStream,
  DeskTopic,
  KpisPayload,
} from '@alx/contracts';
import { AirportStore } from '../db/airport.store';
import { AirportEventsService } from '../events/airport-events.service';
import { instant } from '../http/query';
import { AirportStateService } from '../state/airport-state.service';

const RECENT_ANOMALIES = 50;
const MAX_ALERT_LOG = 200;

/** The live desk: REST snapshots and one SSE stream, built from the same payloads. */
@Controller()
export class LiveController {
  /** One builder per stream topic; each REST endpoint returns the same payload. */
  private readonly payload: { [K in DeskTopic]: () => DeskStream[K] };

  constructor(
    airportState: AirportStateService,
    private readonly store: AirportStore,
    private readonly events: AirportEventsService,
  ) {
    const { state, anomalies } = airportState;
    this.payload = {
      status: () => state.health(),
      board: () => state.board(),
      map: () => state.mapView(),
      alert: () => ({ alerts: state.activeAlerts() }),
      anomaly: () => anomalies.view(RECENT_ANOMALIES),
    };
  }

  @Get('health')
  health() {
    return this.payload.status();
  }

  @Get('board')
  board() {
    return this.payload.board();
  }

  @Get('map')
  map() {
    return this.payload.map();
  }

  @Get('alerts')
  alerts() {
    return this.payload.alert();
  }

  /** The persisted alerts, open and closed, raised up to `until` (default now). */
  @Get('alerts/log')
  async alertLog(
    @Query('until') until?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ): Promise<AlertLogPayload> {
    const untilIso = instant(until, new Date());
    return { alerts: await this.store.loadAlertLog(untilIso, Math.min(limit, MAX_ALERT_LOG)) };
  }

  @Get('anomalies')
  anomalies() {
    return this.payload.anomaly();
  }

  /** Movements, on-time performance and stand utilisation per hour. */
  @Get('kpis')
  kpis(): Promise<KpisPayload> {
    return this.store.kpis();
  }

  /** Every topic once on connect, then each topic again whenever it changes. */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const everything = Object.keys(this.payload) as DeskTopic[];
    return merge(from(everything), this.events.changes$).pipe(
      map((topic) => ({ type: topic, data: this.payload[topic]() })),
    );
  }
}
