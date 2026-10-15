/* eslint-disable @typescript-eslint/naming-convention */ // environment variable names
import { Registry } from 'prom-client';
import { trace } from '@opentelemetry/api';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import type { DependencyContainer } from 'tsyringe';
import { getConfig, initConfig } from '../../src/common/config';
import { registerExternalValues } from '../../src/containerConfig';
import {
  JOB_QUEUE_PROVIDER,
  MAP_PROVIDER,
  METATILE_PROCESSOR,
  METRICS_REGISTRY,
  SERVICES,
  TILES_STORAGE_PROVIDERS,
} from '../../src/common/constants';
import { ShigolaCacheProcessor } from '../../src/retiler/shigola/shigolaCacheProcessor';
import { TileProcessor } from '../../src/retiler/tileProcessor';

describe('containerConfig', () => {
  let logger: Logger;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    logger = await jsLogger({ enabled: false });
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  async function registerWithProvider(env: Record<string, string>): Promise<DependencyContainer> {
    Object.assign(process.env, env);
    await initConfig(true);
    return registerExternalValues({
      override: [
        { token: SERVICES.CONFIG, provider: { useValue: getConfig() } },
        { token: SERVICES.LOGGER, provider: { useValue: logger } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('test') } },
        { token: METRICS_REGISTRY, provider: { useValue: new Registry() } },
        { token: JOB_QUEUE_PROVIDER, provider: { useValue: { startQueue: jest.fn(), stopQueue: jest.fn() } } },
      ],
      useChild: true,
    });
  }

  it('should process metatiles through shigola without a map provider or tiles storage', async () => {
    // with no storage provider the storage factory throws, so this also proves storage is never resolved
    const container = await registerWithProvider({ MAP_PROVIDER: 'shigola', MAP_SHIGOLA_TARGETS: '[{"map":"osm"}]', TILES_STORAGE_PROVIDERS: '[]' });

    expect(container.resolve(METATILE_PROCESSOR)).toBeInstanceOf(ShigolaCacheProcessor);
    expect(container.isRegistered(MAP_PROVIDER)).toBe(false);
    expect(() => container.resolve(TILES_STORAGE_PROVIDERS)).toThrow('at least one provider is required');
  });

  it('should process metatiles through the tile processor for wms', async () => {
    const container = await registerWithProvider({ MAP_PROVIDER: 'wms' });

    expect(container.resolve(METATILE_PROCESSOR)).toBeInstanceOf(TileProcessor);
    expect(container.isRegistered(MAP_PROVIDER)).toBe(true);
  });
});
