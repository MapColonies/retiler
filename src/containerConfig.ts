import { DependencyContainer, Lifecycle, instancePerContainerCachingFactory } from 'tsyringe';
import jsLogger, { Logger, LoggerOptions } from '@map-colonies/js-logger';
import { S3Client } from '@aws-sdk/client-s3';
import { getOtelMixin } from '@map-colonies/telemetry';
import axios from 'axios';
import client from 'prom-client';
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
  SERVICES,
  SERVICE_NAME,
  TILES_STORAGE_PROVIDERS,
  TILES_STORAGE_LAYOUT,
  LIVENESS_PROBE_FACTORY,
  CONSUME_AND_PROCESS_FACTORY,
  MAP_FORMAT,
  MAP_PROVIDER_CONFIG,
  QUEUE_EMPTY_TIMEOUT,
  METRICS_BUCKETS,
  METRICS_REGISTRY,
} from './common/constants';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { ShutdownHandler } from './common/shutdownHandler';
import { tracing } from './common/tracing';
import { JobQueueProvider } from './retiler/interfaces';
import { PgBossJobQueueProvider } from './retiler/jobQueueProvider/pgBossJobQueue';
import { pgBossFactory, PgBossConfig } from './retiler/jobQueueProvider/pgbossFactory';
import { ArcgisMapProvider } from './retiler/mapProvider/arcgis/arcgisMapProvider';
import { SharpMapSplitter } from './retiler/mapSplitterProvider/sharp';
import { S3TilesStorage } from './retiler/tilesStorageProvider/s3';
import { FsStorageProviderConfig, S3StorageProviderConfig, StorageProviderConfig, TileStoragLayout } from './retiler/tilesStorageProvider/interfaces';
import { livenessProbeFactory } from './common/liveness';
import { consumeAndProcessFactory } from './app';
import { WmsMapProvider } from './retiler/mapProvider/wms/wmsMapProvider';
import { MapProviderType } from './retiler/types';
import { WmsConfig } from './retiler/mapProvider/wms/requestParams';
import { IConfig } from './common/interfaces';
import { FsTilesStorage } from './retiler/tilesStorageProvider/fs';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const shutdownHandler = new ShutdownHandler();
  try {
    const queueName = config.get<string>('app.queueName');
    const queueTimeout = config.get<number>('app.jobQueue.waitTimeout');

    const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
    const logger = jsLogger({ ...loggerConfig, mixin: getOtelMixin(), base: { queue: queueName } });

    const tracer = trace.getTracer(SERVICE_NAME);
    shutdownHandler.addFunction(tracing.stop.bind(tracing));

    const mapClientTimeout = config.get<number>('app.map.client.timeoutMs');
    const axiosClient = axios.create({ timeout: mapClientTimeout });

    const dependencies: InjectionObject<unknown>[] = [
      { token: ShutdownHandler, provider: { useValue: shutdownHandler } },
      { token: SERVICES.CONFIG, provider: { useValue: config } },
      { token: SERVICES.LOGGER, provider: { useValue: logger } },
      { token: SERVICES.TRACER, provider: { useValue: tracer } },
      {
        token: METRICS_REGISTRY,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<IConfig>(SERVICES.CONFIG);

            if (config.get<boolean>('telemetry.metrics.enabled')) {
              client.register.setDefaultLabels({ project: config.get<string>('app.projectName') });
              return client.register;
            }
          }),
        },
      },
      {
        token: PgBoss,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<IConfig>(SERVICES.CONFIG);
            const pgBossConfig = config.get<PgBossConfig>('app.jobQueue.pgBoss');
            return pgBossFactory(pgBossConfig);
          }),
        },
      },
      { token: QUEUE_NAME, provider: { useValue: queueName } },
      { token: QUEUE_EMPTY_TIMEOUT, provider: { useValue: queueTimeout } },
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
      { token: METRICS_BUCKETS, provider: { useValue: config.get('telemetry.metrics.buckets') } },
      { token: LIVENESS_PROBE_FACTORY, provider: { useFactory: livenessProbeFactory } },
      { token: PROJECT_NAME_SYMBOL, provider: { useValue: config.get<string>('app.projectName') } },
      { token: SERVICES.HTTP_CLIENT, provider: { useValue: axiosClient } },
      { token: MAP_URL, provider: { useValue: config.get<string>('app.map.url') } },
      { token: MAP_FORMAT, provider: { useValue: config.get<string>('app.map.format') } },
      { token: TILES_STORAGE_LAYOUT, provider: { useValue: config.get<TileStoragLayout>('app.tilesStorage.layout') } },
      { token: MAP_SPLITTER_PROVIDER, provider: { useClass: SharpMapSplitter } },
      {
        token: MAP_PROVIDER_CONFIG,
        provider: { useValue: config.get<WmsConfig>('app.map.wms') },
        postInjectionHook: async (container): Promise<void> => {
          const config = container.resolve<IConfig>(SERVICES.CONFIG);
          const mapProviderType = config.get<MapProviderType>('app.map.provider');

          if (mapProviderType === 'wms') {
            container.register(MAP_PROVIDER, { useClass: WmsMapProvider });
          } else {
            container.register(MAP_PROVIDER, { useClass: ArcgisMapProvider });
          }
          return Promise.resolve();
        },
      },
      {
        token: TILES_STORAGE_PROVIDERS,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<IConfig>(SERVICES.CONFIG);
            const logger = container.resolve<Logger>(SERVICES.LOGGER);
            const storageProvidersConfig = config.get<StorageProviderConfig[]>('app.tilesStorage.providers');
            const tilesStorageLayout = config.get<TileStoragLayout>('app.tilesStorage.layout');
            const s3ClientsMap = new Map<string, S3Client>();

            const storageProviders = storageProvidersConfig.map((providerConfig) => {
              if (providerConfig.type === 's3') {
                const { type, bucketName, ...clientConfig } = providerConfig as S3StorageProviderConfig;
                let s3Client = s3ClientsMap.get(clientConfig.endpoint);

                if (!s3Client) {
                  s3Client = new S3Client(clientConfig);
                  s3ClientsMap.set(clientConfig.endpoint, s3Client);
                  shutdownHandler.addFunction(s3Client.destroy.bind(s3Client));
                }

                return new S3TilesStorage(s3Client, logger, bucketName, tilesStorageLayout);
              }

              const { basePath } = providerConfig as FsStorageProviderConfig;
              return new FsTilesStorage(logger, basePath, tilesStorageLayout);
            });

            container.register(TILES_STORAGE_PROVIDERS, { useValue: storageProviders });
          }),
        },
      },
      { token: CONSUME_AND_PROCESS_FACTORY, provider: { useFactory: consumeAndProcessFactory } },
    ];

    const container = await registerDependencies(dependencies, options?.override, options?.useChild);
    return container;
  } catch (error) {
    await shutdownHandler.shutdown();
    throw error;
  }
};
