import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { AirportStore } from '../db/airport.store';
import { IngestStore } from '../db/ingest.store';
import { makeAnomaly } from '../domain/anomalies';
import { applyMessage, resumeFrom } from '../domain/apply';
import { Normalizer } from '../domain/normalize';
import { SECOND_MS } from '../domain/time';
import { anomalyEvent, timelineOf } from '../domain/timeline';
import type { Anomaly } from '../domain/types';
import { AirportStateService } from '../state/airport-state.service';
import { LineFramer, ndjsonLines } from './framing';

const MIN_BACKOFF_MS = SECOND_MS;
const MAX_BACKOFF_MS = 30 * SECOND_MS;

/**
 * The ingest pipeline: feed lines → frame → normalize → apply → persist.
 * Owns the feed connection; the API never talks to the feed, it mirrors Mongo.
 */
@Injectable()
export class FeedService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FeedService.name);
  private readonly framer = new LineFramer();
  private readonly normalizer = new Normalizer();
  private abort?: AbortController;
  private stopped = false;
  private backoffMs = MIN_BACKOFF_MS;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly airportState: AirportStateService,
    private readonly airportStore: AirportStore,
    private readonly ingestStore: IngestStore,
  ) {}

  private get state() {
    return this.airportState.state;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.resume();
    void this.run();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.abort?.abort();
  }

  /**
   * Closing an alert or a stand occupancy, skipping a counted movement, or
   * knowing when the feed was last heard, needs what earlier runs recorded.
   */
  private async resume(): Promise<void> {
    resumeFrom(this.state, await this.airportStore.loadIngestMemory());
  }

  /** Connect, consume until the stream drops, reconnect (backing off on failures). */
  private async run(): Promise<void> {
    const url = this.config.get('feedUrl', { infer: true });
    while (!this.stopped) {
      try {
        this.logger.log(`Connecting to feed ${url}`);
        this.framer.reset();
        this.normalizer.resetConnection();
        this.state.reconnected();
        await this.consume(url);
        this.logger.warn('Feed stream ended; reconnecting');
      } catch (err) {
        if (this.stopped) return;
        this.logger.warn(`Feed error: ${errorMessage(err)}; retry in ${this.backoffMs}ms`);
        await new Promise((r) => setTimeout(r, this.backoffMs));
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private async consume(url: string): Promise<void> {
    this.abort = new AbortController();
    const response = await fetch(url, {
      signal: this.abort.signal,
      headers: { Accept: 'application/x-ndjson' },
    });
    if (!response.ok || !response.body) throw new Error(`Feed HTTP ${response.status}`);
    this.backoffMs = MIN_BACKOFF_MS; // connected: the next drop retries fast again
    for await (const line of ndjsonLines(response.body)) {
      if (this.stopped) return;
      await this.handleLine(line);
    }
  }

  private async handleLine(line: string): Promise<void> {
    const { complete, abandoned } = this.framer.push(line);
    if (abandoned) {
      await this.recordAnomaly(
        makeAnomaly('invalid_json', 'Abandoned truncated fragment', undefined, abandoned),
      );
    }
    if (complete) await this.handleJson(complete);
  }

  private async handleJson(json: string): Promise<void> {
    const result = this.normalizer.ingest(json);
    if ('anomaly' in result) return this.recordAnomaly(result.anomaly);

    const { message } = result;
    const effects = applyMessage(
      this.state,
      message,
      this.config.get('airportCode', { infer: true }),
    );
    await this.persist(async () => {
      if (effects.linkChanged) {
        await this.ingestStore.saveLink(this.state.exportLink(), message.ts);
      }
      await this.ingestStore.persist(effects, timelineOf(message, effects, this.state));
    });
  }

  private async recordAnomaly(anomaly: Anomaly): Promise<void> {
    const stored = { ...anomaly, connectionEpoch: this.state.link.connectionEpoch };
    await this.persist(() => this.ingestStore.recordAnomaly(stored, anomalyEvent(stored)));
  }

  /** A Mongo hiccup is logged; it must never drop the feed connection. */
  private async persist(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (err) {
      this.logger.error(`Persist failed: ${errorMessage(err)}`);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
