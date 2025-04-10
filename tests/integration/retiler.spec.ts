import * as fsPromises from 'fs/promises';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import client from 'prom-client';
import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe';
import PgBoss from 'pg-boss';
import nock from 'nock';
import { Tile } from '@map-colonies/tile-calc';
import Format from 'string-format';
import httpStatusCodes from 'http-status-codes';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { registerExternalValues } from '../../src/containerConfig';
import { consumeAndProcessFactory } from '../../src/app';
import {
  CONSUME_AND_PROCESS_FACTORY,
  JOB_QUEUE_PROVIDER,
  MAP_URL,
  METRICS_REGISTRY,
  QUEUE_NAME,
  SERVICES,
  TILES_STORAGE_LAYOUT,
  TILES_STORAGE_PROVIDERS,
} from '../../src/common/constants';
import { PgBossJobQueueProvider } from '../../src/retiler/jobQueueProvider/pgBossJobQueue';
import { TilesStorageProvider } from '../../src/retiler/interfaces';
import { getFlippedY } from '../../src/retiler/util';
import { TileStoragLayout } from '../../src/retiler/tilesStorageProvider/interfaces';
import { ConfigType, getConfig, initConfig } from '../../src/common/config';
import { LONG_RUNNING_TEST, waitForJobToBeResolved } from './helpers';

const s3SendMock = jest.fn();

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  writeFile: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock('@aws-sdk/client-s3', () => ({
  ...jest.requireActual('@aws-sdk/client-s3'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  S3Client: jest.fn().mockImplementation(() => ({
    send: s3SendMock,
    destroy: jest.fn(),
    config: {
      region: jest.fn().mockReturnValue('test-region'),
      endpointProvider: jest.fn().mockReturnValue('test-endpoint'),
    },
  })),
}));

describe('retiler', function () {
  let mapUrl: string;
  let stateUrl: string;
  let detilerUrl: string;
  let getMapInterceptor: nock.Interceptor;
  let stateInterceptor: nock.Interceptor;
  let detilerScope: nock.Scope;
  let detilerGetInterceptor: nock.Interceptor;
  let cooldownsGetInterceptor: nock.Interceptor;
  let detilerPutInterceptor: nock.Interceptor;
  let stateBuffer: Buffer;
  let mapBuffer2048x2048: Buffer;
  let mapBuffer512x512: Buffer;
  let determineKey: (tile: Required<Tile>) => string;
  let config: ConfigType;

  beforeAll(async () => {
    await initConfig(true);
    config = getConfig();

    mapUrl = config.get('app.map.url');
    detilerUrl = config.get('detiler.client.url')!;
    stateUrl = config.get('app.project.stateUrl');
    // eslint-disable-next-line @typescript-eslint/naming-convention
    getMapInterceptor = nock(mapUrl).defaultReplyHeaders({ 'content-type': 'image/png' }).get(/.*/);
    stateInterceptor = nock(stateUrl).get(/.*/);
    detilerScope = nock(detilerUrl);
    detilerGetInterceptor = detilerScope.get(/^\/detail/);
    cooldownsGetInterceptor = detilerScope.get(/^\/cooldown/);
    detilerPutInterceptor = detilerScope.put(/.*/);
    stateBuffer = await fsPromises.readFile('tests/state.txt');
    mapBuffer512x512 = await fsPromises.readFile('tests/512x512.png');
    mapBuffer2048x2048 = await fsPromises.readFile('tests/2048x2048.png');
  });

  afterEach(function () {
    nock.removeInterceptor(getMapInterceptor);
    nock.removeInterceptor(stateInterceptor);
    nock.removeInterceptor(detilerGetInterceptor);
    nock.removeInterceptor(cooldownsGetInterceptor);
    nock.removeInterceptor(detilerPutInterceptor);
    jest.clearAllMocks();
  });

  describe('arcgis', function () {
    let container: DependencyContainer;

    beforeEach(async () => {
      container = await registerExternalValues({
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: (key: string) => {
                  switch (key) {
                    case 'app.map.provider':
                      return 'arcgis';
                    default:
                      return config.get(key);
                  }
                },
              },
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
          { token: METRICS_REGISTRY, provider: { useValue: new client.Registry() } },
          { token: TILES_STORAGE_LAYOUT, provider: { useValue: { format: '{z}/{x}/{y}.png', shouldFlipY: true } } },
        ],
        useChild: true,
      });

      const storageLayout = container.resolve<TileStoragLayout>(TILES_STORAGE_LAYOUT);

      determineKey = (tile: Required<Tile>): string => {
        if (storageLayout.shouldFlipY) {
          tile.y = getFlippedY(tile);
        }
        const key = Format(storageLayout.format, tile);
        return key;
      };
    });

    afterEach(async () => {
      const pgBoss = container.resolve(PgBoss);
      await pgBoss.clearStorage();
    });

    afterAll(async () => {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
      container.reset();
    });

    describe('Happy Path', function () {
      it(
        'should complete a single job',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(4));

          for (const storeTileSpy of storeTileSpies) {
            for (let i = 0; i < 4; i++) {
              const storeCall = storeTileSpy.mock.calls[i][0];
              const key = determineKey({ x: storeCall.x, y: storeCall.y, z: storeCall.z, metatile: storeCall.metatile });
              const expectedBuffer = await fsPromises.readFile(`tests/integration/expected/${key}`);
              expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
            }
          }

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete a single job that has state',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent', state: 666 } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');
          expect(job).toHaveProperty('data.state', 666);

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(4));

          for (const storeTileSpy of storeTileSpies) {
            for (let i = 0; i < 4; i++) {
              const storeCall = storeTileSpy.mock.calls[i][0];
              const key = determineKey({ x: storeCall.x, y: storeCall.y, z: storeCall.z, metatile: storeCall.metatile });
              const expectedBuffer = await fsPromises.readFile(`tests/integration/expected/${key}`);
              expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
            }
          }

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete a single job where tile is skipped',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.OK, { renderedAt: 1705353636, updateedAt: 9999999999 });
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const stateScope = stateInterceptor.reply(httpStatusCodes.OK, stateBuffer);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(0));

          detilerScope.done();
          stateScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete a single job where tile is not skipped',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.OK, { renderedAt: 0 });
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const stateScope = stateInterceptor.reply(httpStatusCodes.OK, stateBuffer);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(4));

          for (const storeTileSpy of storeTileSpies) {
            for (let i = 0; i < 4; i++) {
              const storeCall = storeTileSpy.mock.calls[i][0];
              const key = determineKey({ x: storeCall.x, y: storeCall.y, z: storeCall.z, metatile: storeCall.metatile });
              const expectedBuffer = await fsPromises.readFile(`tests/integration/expected/${key}`);
              expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
            }
          }

          getMapScope.done();
          detilerScope.done();
          stateScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete a single job where tile is not skipped even if a cooldown is found',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.OK, { renderedAt: 0 });
          cooldownsGetInterceptor.reply(httpStatusCodes.OK, [{ duration: 1 }]);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const stateScope = stateInterceptor.reply(httpStatusCodes.OK, stateBuffer);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(4));

          for (const storeTileSpy of storeTileSpies) {
            for (let i = 0; i < 4; i++) {
              const storeCall = storeTileSpy.mock.calls[i][0];
              const key = determineKey({ x: storeCall.x, y: storeCall.y, z: storeCall.z, metatile: storeCall.metatile });
              const expectedBuffer = await fsPromises.readFile(`tests/integration/expected/${key}`);
              expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
            }
          }

          getMapScope.done();
          detilerScope.done();
          stateScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete a single job where tile processing is skipped due to cooldown',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.OK, { renderedAt: 0 });
          cooldownsGetInterceptor.reply(httpStatusCodes.OK, [{ duration: 9999999999 }]);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const stateScope = stateInterceptor.reply(httpStatusCodes.OK, stateBuffer);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(0));

          detilerScope.done();
          stateScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete a single job where tile is forced',
        async function () {
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent', force: true } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');
          expect(job).toHaveProperty('data.force', true);

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(4));

          for (const storeTileSpy of storeTileSpies) {
            for (let i = 0; i < 4; i++) {
              const storeCall = storeTileSpy.mock.calls[i][0];
              const key = determineKey({ x: storeCall.x, y: storeCall.y, z: storeCall.z, metatile: storeCall.metatile });
              const expectedBuffer = await fsPromises.readFile(`tests/integration/expected/${key}`);
              expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
            }
          }

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete multiple jobs',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);
          getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);
          getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const request1 = { name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } };
          const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } };
          const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };

          const [jobId1, jobId2, jobId3] = await Promise.all([pgBoss.send(request1), pgBoss.send(request2), pgBoss.send(request3)]);

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const [job1, job2, job3] = await Promise.all([
            waitForJobToBeResolved(pgBoss, jobId1 as string),
            waitForJobToBeResolved(pgBoss, jobId2 as string),
            waitForJobToBeResolved(pgBoss, jobId3 as string),
          ]);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job1).toHaveProperty('state', 'completed');
          expect(job2).toHaveProperty('state', 'completed');
          expect(job3).toHaveProperty('state', 'completed');

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete multiple jobs where some are forced',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerGetInterceptor.reply(httpStatusCodes.OK, { renderedAt: 0 });
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const stateScope = stateInterceptor.reply(httpStatusCodes.OK, stateBuffer);
          stateInterceptor.reply(httpStatusCodes.OK, stateBuffer);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);
          getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);
          getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const request1 = { name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent', force: true } };
          const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent', force: false } };
          const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };

          const [jobId1, jobId2, jobId3] = await Promise.all([pgBoss.send(request1), pgBoss.send(request2), pgBoss.send(request3)]);

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const [job1, job2, job3] = await Promise.all([
            waitForJobToBeResolved(pgBoss, jobId1 as string),
            waitForJobToBeResolved(pgBoss, jobId2 as string),
            waitForJobToBeResolved(pgBoss, jobId3 as string),
          ]);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job1).toHaveProperty('state', 'completed');
          expect(job1).toHaveProperty('data.force', true);
          expect(job2).toHaveProperty('state', 'completed');
          expect(job2).toHaveProperty('data.force', false);
          expect(job3).toHaveProperty('state', 'completed');
          expect(job3).not.toHaveProperty('data.force');

          getMapScope.done();
          detilerScope.done();
          stateScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete some jobs even when one fails',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);
          getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);

          const pgBoss = container.resolve(PgBoss);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const request1 = { name: queueName, data: { z: 0, x: 10, y: 10, metatile: 8, parent: 'parent' } };
          const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } };
          const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };

          const [jobId1, jobId2, jobId3] = await Promise.all([pgBoss.send(request1), pgBoss.send(request2), pgBoss.send(request3)]);

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const [job1, job2, job3] = await Promise.all([
            waitForJobToBeResolved(pgBoss, jobId1 as string),
            waitForJobToBeResolved(pgBoss, jobId2 as string),
            waitForJobToBeResolved(pgBoss, jobId3 as string),
          ]);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job1).toHaveProperty('state', 'failed');
          expect(job1).toHaveProperty('output.message', 'x index out of range of tile grid');
          expect(job2).toHaveProperty('state', 'completed');
          expect(job3).toHaveProperty('state', 'completed');

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete even if detiler get throws an error',
        async function () {
          const detilerGetScope = nock(detilerUrl).get(/.*/).replyWithError({ message: 'detiler get error' });
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);
          detilerPutInterceptor.reply(httpStatusCodes.OK);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          detilerGetScope.done();
          getMapScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should completed even if getting state throws an error',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.OK, { renderedAt: 0 });
          const stateScope = nock(stateUrl).get(/.*/).replyWithError({ message: 'state get error' });
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);
          detilerPutInterceptor.reply(httpStatusCodes.OK);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          detilerScope.done();
          getMapScope.done();
          stateScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should complete even if detiler set throws an error',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          const detilerSetScope = nock(detilerUrl).put(/.*/).replyWithError({ message: 'detiler set error' });
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          detilerScope.done();
          getMapScope.done();
          detilerSetScope.done();
        },
        LONG_RUNNING_TEST
      );
    });

    describe('Bad Path', function () {
      it(
        'should fail the job if the tile is out of bounds',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 10, y: 10, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          expect(job).toHaveProperty('output.message', 'x index out of range of tile grid');
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should fail the job if map fetching service returns an error',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          const mapUrl = container.resolve<string>(MAP_URL);
          const getMapScope = nock(mapUrl).get(/.*/).replyWithError({ message: 'fetching map error' });

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          expect(job).toHaveProperty('output.message', 'fetching map error');

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should fail the job if map fetching service is unavailable',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.SERVICE_UNAVAILABLE);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          expect(job).toHaveProperty('output.message', 'Request failed with status code 503');

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should fail the job if tile storage provider storeTile had thrown an error',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const error = new Error('storing error');

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          jest.spyOn(storageProviders[0], 'storeTile').mockRejectedValue(error);

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          expect(job).toHaveProperty('output.message', error.message);

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should fail the job if s3 tile storage provider storeTile had thrown an error',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);
          const errorMessage = 'send error';
          const error = new Error(errorMessage);
          s3SendMock.mockRejectedValueOnce(error);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          const jobOutput = job?.output as object as { [index: string]: string };
          expect(jobOutput['message']).toContain(error.message);

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should fail the job if fs tile storage provider storeTile had thrown an error',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);
          const errorMessage = 'write error';
          const error = new Error(errorMessage);
          (fsPromises.writeFile as jest.Mock).mockRejectedValueOnce(error);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          const jobOutput = job?.output as object as { [index: string]: string };
          expect(jobOutput['message']).toContain(error.message);

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );
    });

    describe('Sad Path', function () {
      it('should throw an error if pgboss rejects fetching', async function () {
        const pgBoss = container.resolve(PgBoss);

        const fetchError = new Error('fetch error');
        jest.spyOn(pgBoss, 'fetch').mockRejectedValue(fetchError);

        const promise = consumeAndProcessFactory(container)();
        await expect(promise).rejects.toThrow(fetchError);
      });
    });
  });

  describe('wms', function () {
    let container: DependencyContainer;

    beforeEach(async () => {
      container = await registerExternalValues({
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: (key: string) => {
                  switch (key) {
                    case 'app.map.provider':
                      return 'wms';
                    case 'app.jobQueue.pgBoss.schema':
                      return 'public';
                    default:
                      return config.get(key);
                  }
                },
              },
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
          { token: METRICS_REGISTRY, provider: { useValue: new client.Registry() } },
          { token: TILES_STORAGE_LAYOUT, provider: { useValue: { format: '{z}/{x}/{y}.png', shouldFlipY: true } } },
        ],
        useChild: true,
      });

      const storageLayout = container.resolve<TileStoragLayout>(TILES_STORAGE_LAYOUT);

      determineKey = (tile: Required<Tile>): string => {
        if (storageLayout.shouldFlipY) {
          tile.y = getFlippedY(tile);
        }
        const key = Format(storageLayout.format, tile);
        return key;
      };
    });

    afterEach(async () => {
      const pgBoss = container.resolve(PgBoss);
      await pgBoss.clearStorage();
    });

    afterAll(async () => {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
      container.reset();
    });

    describe('Happy path', function () {
      it(
        'should complete a single job',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(4));

          for (const storeTileSpy of storeTileSpies) {
            for (let i = 0; i < 4; i++) {
              const storeCall = storeTileSpy.mock.calls[i][0];
              const key = determineKey({ x: storeCall.x, y: storeCall.y, z: storeCall.z, metatile: storeCall.metatile });
              const expectedBuffer = await fsPromises.readFile(`tests/integration/expected/${key}`);
              expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
            }
          }

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );
    });

    describe('Bad path', function () {
      it(
        'should fail the job if map fetching service returns an error',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          const getMapScope = nock(mapUrl).get(/.*/).replyWithError({ message: 'fetching map error' });

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          expect(job).toHaveProperty('output.message', 'fetching map error');

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );

      it(
        'should fail the job if map fetching service returns an ok with xml content type',
        async function () {
          detilerGetInterceptor.reply(httpStatusCodes.NOT_FOUND);
          // eslint-disable-next-line @typescript-eslint/naming-convention
          const getMapScope = getMapInterceptor.reply(200, '<xml></xml>', { 'content-type': 'text/xml' });

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          expect(job).toHaveProperty('output.message', 'The response returned from the service was in xml format');

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );
    });
  });

  describe('disabled detiler', function () {
    let container: DependencyContainer;

    beforeEach(async () => {
      container = await registerExternalValues({
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: (key: string) => {
                  switch (key) {
                    case 'detiler.enabled':
                      return false;
                    default:
                      return config.get(key);
                  }
                },
              },
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
          { token: METRICS_REGISTRY, provider: { useValue: new client.Registry() } },
          { token: TILES_STORAGE_LAYOUT, provider: { useValue: { format: '{z}/{x}/{y}.png', shouldFlipY: true } } },
        ],
        useChild: true,
      });

      const storageLayout = container.resolve<TileStoragLayout>(TILES_STORAGE_LAYOUT);

      determineKey = (tile: Required<Tile>): string => {
        if (storageLayout.shouldFlipY) {
          tile.y = getFlippedY(tile);
        }
        const key = Format(storageLayout.format, tile);
        return key;
      };
    });

    afterEach(async () => {
      const pgBoss = container.resolve(PgBoss);
      await pgBoss.clearStorage();
    });

    afterAll(async () => {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
      container.reset();
    });

    describe('Happy Path', function () {
      it(
        'should complete a single job',
        async function () {
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(4));

          for (const storeTileSpy of storeTileSpies) {
            for (let i = 0; i < 4; i++) {
              const storeCall = storeTileSpy.mock.calls[i][0];
              const key = determineKey({ x: storeCall.x, y: storeCall.y, z: storeCall.z, metatile: storeCall.metatile });
              const expectedBuffer = await fsPromises.readFile(`tests/integration/expected/${key}`);
              expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
            }
          }

          getMapScope.done();
        },
        LONG_RUNNING_TEST
      );

      it('should complete running jobs', async function () {
        const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048).persist();

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const request1 = { name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request4 = { name: queueName, data: { z: 3, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request5 = { name: queueName, data: { z: 4, x: 0, y: 0, metatile: 8, parent: 'parent' } };

        await pgBoss.insert([request1, request2, request3, request4, request5]);

        const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

        await setTimeoutPromise(20);
        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();

        getMapScope.done();
      });
    });
  });

  describe('forced processing with no proceeding on failure', function () {
    let container: DependencyContainer;

    beforeEach(async () => {
      container = await registerExternalValues({
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: (key: string) => {
                  switch (key) {
                    case 'app.forceProcess':
                      return true;
                    case 'detiler.proceedOnFailure':
                      return false;
                    default:
                      return config.get(key);
                  }
                },
              },
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
          { token: METRICS_REGISTRY, provider: { useValue: new client.Registry() } },
          { token: TILES_STORAGE_LAYOUT, provider: { useValue: { format: '{z}/{x}/{y}.png', shouldFlipY: true } } },
        ],
        useChild: true,
      });

      const storageLayout = container.resolve<TileStoragLayout>(TILES_STORAGE_LAYOUT);

      determineKey = (tile: Required<Tile>): string => {
        if (storageLayout.shouldFlipY) {
          tile.y = getFlippedY(tile);
        }
        const key = Format(storageLayout.format, tile);
        return key;
      };
    });

    afterEach(async () => {
      const pgBoss = container.resolve(PgBoss);
      await pgBoss.clearStorage();
    });

    afterAll(async () => {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
      container.reset();
    });

    describe('Happy Path', function () {
      it(
        'should complete a single job',
        async function () {
          detilerPutInterceptor.reply(httpStatusCodes.OK);
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
          const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);
          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'completed');

          storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(4));

          for (const storeTileSpy of storeTileSpies) {
            for (let i = 0; i < 4; i++) {
              const storeCall = storeTileSpy.mock.calls[i][0];
              const key = determineKey({ x: storeCall.x, y: storeCall.y, z: storeCall.z, metatile: storeCall.metatile });
              const expectedBuffer = await fsPromises.readFile(`tests/integration/expected/${key}`);
              expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
            }
          }

          getMapScope.done();
          detilerScope.done();
        },
        LONG_RUNNING_TEST
      );
    });

    describe('Sad Path', function () {
      it(
        'should fail the job if detiler set has failed',
        async function () {
          const detilerSetScope = nock(detilerUrl).put(/.*/).replyWithError({ message: 'detiler set error' });
          const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer512x512);

          const pgBoss = container.resolve(PgBoss);
          const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
          const queueName = container.resolve<string>(QUEUE_NAME);
          const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

          const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

          const job = await waitForJobToBeResolved(pgBoss, jobId as string);

          await provider.stopQueue();

          await expect(consumePromise).resolves.not.toThrow();

          expect(job).toHaveProperty('state', 'failed');
          expect(job).toHaveProperty('output.message', 'detiler set error');

          detilerScope.done();
          getMapScope.done();
          detilerSetScope.done();
        },
        LONG_RUNNING_TEST
      );
    });
  });

  describe('blankTilesFilterer', function () {
    let container: DependencyContainer;
    beforeAll(async () => {
      container = await registerExternalValues({
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: (key: string) => {
                  switch (key) {
                    case 'app.tilesStorage.shouldFilterBlankTiles':
                      return true;
                    default:
                      return config.get(key);
                  }
                },
              },
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
          { token: METRICS_REGISTRY, provider: { useValue: new client.Registry() } },
          { token: TILES_STORAGE_LAYOUT, provider: { useValue: { format: '{z}/{x}/{y}.png', shouldFlipY: true } } },
        ],
        useChild: true,
      });

      const storageLayout = container.resolve<TileStoragLayout>(TILES_STORAGE_LAYOUT);

      determineKey = (tile: Required<Tile>): string => {
        if (storageLayout.shouldFlipY) {
          tile.y = getFlippedY(tile);
        }
        const key = Format(storageLayout.format, tile);
        return key;
      };
    });

    afterEach(async () => {
      const pgBoss = container.resolve(PgBoss);
      await pgBoss.clearStorage();
    });

    afterAll(async () => {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
      container.reset();
    });

    it(
      'should filter out blank tiles',
      async function () {
        detilerPutInterceptor.reply(httpStatusCodes.OK);
        const getMapScope = getMapInterceptor.reply(httpStatusCodes.OK, mapBuffer2048x2048);

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } });

        const consumePromise = container.resolve<ReturnType<typeof consumeAndProcessFactory>>(CONSUME_AND_PROCESS_FACTORY)();

        const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
        const storeTileSpies = storageProviders.map((provider) => jest.spyOn(provider, 'storeTile'));

        const job = await waitForJobToBeResolved(pgBoss, jobId as string);
        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();

        expect(job).toHaveProperty('state', 'completed');

        storeTileSpies.forEach((spy) => expect(spy.mock.calls).toHaveLength(5));

        getMapScope.done();
        detilerScope.done();
      },
      LONG_RUNNING_TEST
    );
  });
});
