import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/configuration';
import { AirportStore } from './db/airport.store';
import { IngestStore } from './db/ingest.store';
import { MongoService } from './db/mongo.service';
import { FeedService } from './feed/feed.service';
import { AirportStateService } from './state/airport-state.service';

/** Ingest process: owns the feed connection and every write to Mongo. */
@Module({
  imports: [AppConfigModule],
  providers: [MongoService, AirportStore, IngestStore, AirportStateService, FeedService],
})
export class IngestModule {}
