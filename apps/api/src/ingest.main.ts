import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IngestModule } from './ingest.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(IngestModule);
  // Close cleanly (FeedService aborts the feed, Mongo disconnects) on stop.
  app.enableShutdownHooks();
  Logger.log('Ingest worker running (feed → Mongo)', 'Bootstrap');
}

void bootstrap();
