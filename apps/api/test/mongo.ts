import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import type { AppConfig } from '../src/config/configuration';
import { MongoService } from '../src/db/mongo.service';

/** The version the compose stack runs (`mongo:7`). Downloaded once, then cached. */
const MONGO_VERSION = '7.0.14';

/**
 * A throwaway MongoDB for store tests: one server per test file, and a fresh
 * database (with the real indexes) per `connect()`.
 */
export async function throwawayMongo() {
  Logger.overrideLogger(false);
  const server = await MongoMemoryServer.create({ binary: { version: MONGO_VERSION } });
  let databases = 0;
  return {
    async connect(): Promise<MongoService> {
      const uri = `${server.getUri()}test-${++databases}`;
      const mongo = new MongoService({ get: () => uri } as unknown as ConfigService<AppConfig, true>);
      await mongo.onModuleInit();
      return mongo;
    },
    stop: () => server.stop(),
  };
}
