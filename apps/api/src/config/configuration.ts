import { ConfigModule } from '@nestjs/config';

export interface AppConfig {
  feedUrl: string;
  /** The airport this desk serves; a feed announcing another one is locked out. */
  airportCode: string;
  mongodbUri: string;
  port: number;
}

function configuration(): AppConfig {
  return {
    feedUrl:
      process.env.FEED_URL ??
      'https://rt-al-dev-generator.airportlabs.com/realistic/ndjson',
    airportCode: process.env.AIRPORT_CODE ?? 'ALX',
    mongodbUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/alx',
    port: parseInt(process.env.API_PORT ?? '3001', 10),
  };
}

/** Env + `.env` loading, shared by both entry points (API and ingest). */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  load: [configuration],
  envFilePath: ['.env', '../../.env'],
});
