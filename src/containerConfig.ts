import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import { logMethod } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import config from 'config';
import { ConstructorOptions } from 'pg-boss';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import {
  DB_OPTIONS,
  JOBS_QUEUE_PROVIDER,
  MAP_PROVIDER,
  MAP_SPLITTER_PROVIDER,
  MAP_URL,
  PROJECT_NAME_SYMBOL,
  QUEUE_NAME,
  S3_BUCKET,
  S3_CLIENT_CONFIG,
  SERVICES,
  SERVICE_NAME,
  TILES_STORAGE_PROVIDER,
  TILE_PATH_LAYOUT,
} from './common/constants';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { ShutdownHandler } from './common/shutdownHandler';
import { tracing } from './common/tracing';
import { PgBossJobsQueue } from './retiler/jobsQueueProvider/pgboss';
import { createDatabaseOptions, DbConfig, DbOptions } from './retiler/jobsQueueProvider/pgbossFactory';
import { ArcgisExportMapProvider } from './retiler/mapProvider/arcgisExport';
import { SharpMapSplitter } from './retiler/mapSplitterProvider/sharp';
import { TilePathLayout } from './retiler/tilesPath';
import { S3TilesStorage } from './retiler/tilesStorageProvider/s3';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const shutdownHandler = new ShutdownHandler();
  try {
    const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
    // @ts-expect-error the signature is wrong
    const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, hooks: { logMethod } });

    const dbOptions: ConstructorOptions = await createDatabaseOptions({
      ...config.get<DbConfig>('app.jobsQueue.pg-boss.db'),
      ...config.get<DbOptions>('app.jobsQueue.pg-boss.maintenance'),
    });

    tracing.start();
    const tracer = trace.getTracer(SERVICE_NAME);
    shutdownHandler.addFunction(tracing.stop.bind(tracing));

    const s3Config = config.get<S3ClientConfig>('app.tilesStorage.s3ClientConfig');
    const s3Client = new S3Client(s3Config);
    shutdownHandler.addFunction(s3Client.destroy.bind(s3Client));

    const dependencies: InjectionObject<unknown>[] = [
      { token: ShutdownHandler, provider: { useValue: shutdownHandler } },
      { token: SERVICES.CONFIG, provider: { useValue: config } },
      { token: SERVICES.LOGGER, provider: { useValue: logger } },
      { token: SERVICES.TRACER, provider: { useValue: tracer } },
      { token: SERVICES.S3, provider: { useValue: s3Client } },
      { token: PROJECT_NAME_SYMBOL, provider: { useValue: config.get<string>('app.projectName') } },
      { token: MAP_URL, provider: { useValue: config.get<string>('app.map.url') } },
      { token: S3_BUCKET, provider: { useValue: config.get<string>('app.tilesStorage.s3Bucket') } },
      { token: TILE_PATH_LAYOUT, provider: { useValue: config.get<TilePathLayout>('app.tilesStorage.tilePathLayout') } },
      { token: QUEUE_NAME, provider: { useValue: config.get<string>('app.queueName') } },
      { token: DB_OPTIONS, provider: { useValue: dbOptions } },
      { token: JOBS_QUEUE_PROVIDER, provider: { useClass: PgBossJobsQueue } },
      { token: MAP_PROVIDER, provider: { useClass: ArcgisExportMapProvider } },
      { token: MAP_SPLITTER_PROVIDER, provider: { useClass: SharpMapSplitter } },
      { token: TILES_STORAGE_PROVIDER, provider: { useClass: S3TilesStorage } },
    ];

    return registerDependencies(dependencies, options?.override, options?.useChild);
  } catch (error) {
    await shutdownHandler.shutdown();
    throw error;
  }
};
