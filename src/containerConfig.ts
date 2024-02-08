import { DependencyContainer, Lifecycle, instancePerContainerCachingFactory } from 'tsyringe';
import jsLogger, { Logger, LoggerOptions } from '@map-colonies/js-logger';
import { getOtelMixin } from '@map-colonies/telemetry';
import axios from 'axios';
import client from 'prom-client';
import { trace } from '@opentelemetry/api';
import config from 'config';
import PgBoss from 'pg-boss';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { DetilerClient, DetilerClientConfig } from '@map-colonies/detiler-client';
import {
  JOB_QUEUE_PROVIDER,
  MAP_PROVIDER,
  MAP_SPLITTER_PROVIDER,
  MAP_URL,
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
  ON_SIGNAL,
} from './common/constants';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { tracing } from './common/tracing';
import { JobQueueProvider } from './retiler/interfaces';
import { PgBossJobQueueProvider } from './retiler/jobQueueProvider/pgBossJobQueue';
import { pgBossFactory, PgBossConfig } from './retiler/jobQueueProvider/pgbossFactory';
import { ArcgisMapProvider } from './retiler/mapProvider/arcgis/arcgisMapProvider';
import { SharpMapSplitter } from './retiler/mapSplitterProvider/sharp';
import { TileStoragLayout } from './retiler/tilesStorageProvider/interfaces';
import { livenessProbeFactory } from './common/liveness';
import { consumeAndProcessFactory } from './app';
import { WmsMapProvider } from './retiler/mapProvider/wms/wmsMapProvider';
import { MapProviderType } from './retiler/types';
import { WmsConfig } from './retiler/mapProvider/wms/requestParams';
import { IConfig } from './common/interfaces';
import { tilesStorageProvidersFactory } from './retiler/tilesStorageProvider/factory';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const queueName = config.get<string>('app.queueName');
    const queueTimeout = config.get<number>('app.jobQueue.waitTimeout');

    const dependencies: InjectionObject<unknown>[] = [
      {
        token: SERVICES.LOGGER,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<IConfig>(SERVICES.CONFIG);
            const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
            const logger = jsLogger({ ...loggerConfig, mixin: getOtelMixin(), base: { queue: queueName } });
            const cleanupRegistryLogger = logger.child({ subComponent: 'cleanupRegistry' });
            cleanupRegistry.on('itemFailed', (id, error, msg) => cleanupRegistryLogger.error({ msg, itemId: id, err: error }));
            cleanupRegistry.on('finished', (status) => cleanupRegistryLogger.info({ msg: `cleanup registry finished cleanup`, status }));
            return logger;
          }),
        },
      },
      {
        token: SERVICES.CLEANUP_REGISTRY,
        provider: { useValue: cleanupRegistry },
      },
      { token: SERVICES.CONFIG, provider: { useValue: config } },
      {
        token: SERVICES.TRACER,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const tracer = trace.getTracer(SERVICE_NAME);
            const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
            cleanupRegistry.register({ func: tracing.stop.bind(tracing), id: SERVICES.TRACER });
            return tracer;
          }),
        },
      },
      {
        token: METRICS_REGISTRY,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<IConfig>(SERVICES.CONFIG);

            if (config.get<boolean>('telemetry.metrics.enabled')) {
              client.register.setDefaultLabels({ project: config.get<string>('app.project.name') });
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
          cleanupRegistry.register({ func: provider.stopQueue.bind(provider), id: JOB_QUEUE_PROVIDER });
          await provider.startQueue();
        },
      },
      { token: METRICS_BUCKETS, provider: { useValue: config.get('telemetry.metrics.buckets') } },
      { token: LIVENESS_PROBE_FACTORY, provider: { useFactory: livenessProbeFactory } },
      {
        token: SERVICES.HTTP_CLIENT,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<IConfig>(SERVICES.CONFIG);

            const mapClientTimeout = config.get<number>('app.map.client.timeoutMs');
            return axios.create({ timeout: mapClientTimeout });
          }),
        },
      },
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
      { token: TILES_STORAGE_PROVIDERS, provider: { useFactory: instancePerContainerCachingFactory(tilesStorageProvidersFactory) } },
      { token: CONSUME_AND_PROCESS_FACTORY, provider: { useFactory: consumeAndProcessFactory } },
      {
        token: ON_SIGNAL,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
            return cleanupRegistry.trigger.bind(cleanupRegistry);
          }),
        },
      },
      {
        token: SERVICES.DETILER,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<IConfig>(SERVICES.CONFIG);
            const enableDetiler = config.get<boolean>('detiler.enabled');
            if (enableDetiler) {
              const logger = container.resolve<Logger>(SERVICES.LOGGER);
              const clientConfig = config.get<DetilerClientConfig>('detiler.client');
              const detiler = new DetilerClient({ ...clientConfig, logger: logger.child({ subComponent: 'detiler' }) });
              return detiler;
            }
          }),
        },
      },
    ];

    const container = await registerDependencies(dependencies, options?.override, options?.useChild);
    return container;
  } catch (error) {
    await cleanupRegistry.trigger();
    throw error;
  }
};
