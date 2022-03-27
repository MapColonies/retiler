import { DependencyContainer, Lifecycle } from 'tsyringe';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import { logMethod } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import config from 'config';
import PgBoss from 'pg-boss';
import {
  JOB_QUEUE_PROVIDER,
  MAP_PROVIDER,
  MAP_SPLITTER_PROVIDER,
  MAP_URL,
  PROJECT_NAME_SYMBOL,
  QUEUE_NAME,
  S3_BUCKET,
  SERVICES,
  SERVICE_NAME,
  TILES_STORAGE_PROVIDER,
  TILE_PATH_LAYOUT,
} from './common/constants';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { ShutdownHandler } from './common/shutdownHandler';
import { tracing } from './common/tracing';
import { JobQueueProvider } from './retiler/interfaces';
import { PgBossJobQueueProvider } from './retiler/jobQueueProvider/pgBossJobQueue';
import { pgBossFactory, PgBossConfig } from './retiler/jobQueueProvider/pgbossFactory';
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

    const pgBossConfig = config.get<PgBossConfig>('app.jobQueue.pgBoss');
    const pgBoss = await pgBossFactory(pgBossConfig);

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
      { token: PgBoss, provider: { useValue: pgBoss } },
      { token: QUEUE_NAME, provider: { useValue: config.get<string>('app.queueName') } },
      {
        token: JOB_QUEUE_PROVIDER,
        provider: { useClass: PgBossJobQueueProvider },
        options: { lifecycle: Lifecycle.Singleton },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const provider = deps.resolve<JobQueueProvider>(JOB_QUEUE_PROVIDER);
          shutdownHandler.addFunction(provider.stopQueue.bind(provider));
          await provider.startQueue();
        },
      },
      { token: PROJECT_NAME_SYMBOL, provider: { useValue: config.get<string>('app.projectName') } },
      { token: MAP_URL, provider: { useValue: config.get<string>('app.map.url') } },
      { token: S3_BUCKET, provider: { useValue: config.get<string>('app.tilesStorage.s3Bucket') } },
      { token: TILE_PATH_LAYOUT, provider: { useValue: config.get<TilePathLayout>('app.tilesStorage.tilePathLayout') } },
      { token: MAP_PROVIDER, provider: { useClass: ArcgisExportMapProvider } },
      { token: MAP_SPLITTER_PROVIDER, provider: { useClass: SharpMapSplitter } },
      { token: TILES_STORAGE_PROVIDER, provider: { useClass: S3TilesStorage } },
    ];

    const container =  await registerDependencies(dependencies, options?.override, options?.useChild);
    return container;
  } catch (error) {
    await shutdownHandler.shutdown();
    throw error;
  }
};
