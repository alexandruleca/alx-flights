import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/configuration';
import { AirportStore } from './db/airport.store';
import { MongoService } from './db/mongo.service';
import { TimelineStore } from './db/timeline.store';
import { AirportEventsService } from './events/airport-events.service';
import { HistoryController } from './history/history.controller';
import { LiveController } from './live/live.controller';
import { AirportStateService } from './state/airport-state.service';
import { MirrorService } from './sync/mirror.service';

/** API process: mirrors Mongo into memory and serves the live desk + replay. */
@Module({
  imports: [AppConfigModule],
  controllers: [LiveController, HistoryController],
  providers: [
    MongoService,
    AirportStore,
    TimelineStore,
    AirportStateService,
    AirportEventsService,
    MirrorService,
  ],
})
export class AppModule {}
