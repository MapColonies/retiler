import { setInterval as setIntervalPromise, setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { readFile } from 'fs/promises';
import client from 'prom-client';
import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import config from 'config';
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

async function waitForJobToBeResolved(boss: PgBoss, jobId: string): Promise<PgBoss.JobWithMetadata | null> {
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
  for await (const _unused of setIntervalPromise(10)) {
    const job = await boss.getJobById(jobId);
    if (job?.completedon) {
      return job;
    }
  }
  return null;
}

describe('retiler', function () {
  let interceptor: nock.Interceptor;
  let determineKey: (tile: Required<Tile>) => string;

  beforeAll(function () {
    const mapUrl = config.get<string>('app.map.url');
    // eslint-disable-next-line @typescript-eslint/naming-convention
    interceptor = nock(mapUrl).defaultReplyHeaders({ 'content-type': 'image/png' }).get(/.*/);
  });

  afterEach(function () {
    nock.removeInterceptor(interceptor);
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
      it('should complete a single job', async function () {
        const mapBuffer = await readFile('tests/512x512.png');
        const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer);

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

        const consumePromise = consumeAndProcessFactory(container)();

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
            const expectedBuffer = await readFile(`tests/integration/expected/${key}`);
            expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
          }
        }

        scope.done();
      });

      it('should complete multiple jobs', async function () {
        const mapBuffer = await readFile('tests/2048x2048.png');
        const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer).persist();

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const request1 = { name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };

        const [jobId1, jobId2, jobId3] = await Promise.all([pgBoss.send(request1), pgBoss.send(request2), pgBoss.send(request3)]);

        const consumePromise = consumeAndProcessFactory(container)();

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

        scope.done();
      });

      it('should complete running jobs', async function () {
        const mapBuffer = await readFile('tests/2048x2048.png');
        const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer).persist();

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const request1 = { name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request4 = { name: queueName, data: { z: 3, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request5 = { name: queueName, data: { z: 4, x: 0, y: 0, metatile: 8, parent: 'parent' } };

        await pgBoss.insert([request1, request2, request3, request4, request5]);

        const consumePromise = consumeAndProcessFactory(container)();

        await setTimeoutPromise(5);
        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();
        scope.done();
      });

      it('should complete some jobs even when one fails', async function () {
        const mapBuffer = await readFile('tests/2048x2048.png');
        const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer).persist();

        const pgBoss = container.resolve(PgBoss);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const request1 = { name: queueName, data: { z: 0, x: 10, y: 10, metatile: 8, parent: 'parent' } };
        const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } };
        const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };

        const [jobId1, jobId2, jobId3] = await Promise.all([pgBoss.send(request1), pgBoss.send(request2), pgBoss.send(request3)]);

        const consumePromise = consumeAndProcessFactory(container)();

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

        scope.done();
      }, 10000);
    });

    describe('Bad Path', function () {
      it('should fail the job if the tile is out of bounds', async function () {
        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 10, y: 10, metatile: 8, parent: 'parent' } });

        const consumePromise = consumeAndProcessFactory(container)();

        const job = await waitForJobToBeResolved(pgBoss, jobId as string);

        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();

        expect(job).toHaveProperty('state', 'failed');
        expect(job).toHaveProperty('output.message', 'x index out of range of tile grid');
      });

      it('should fail the job if map fetching service returns an error', async function () {
        const mapUrl = container.resolve<string>(MAP_URL);
        const scope = nock(mapUrl).get(/.*/).replyWithError({ message: 'fetching map error' });

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

        const consumePromise = consumeAndProcessFactory(container)();

        const job = await waitForJobToBeResolved(pgBoss, jobId as string);

        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();

        expect(job).toHaveProperty('state', 'failed');
        expect(job).toHaveProperty('output.message', 'fetching map error');

        scope.done();
      });

      it('should fail the job if map fetching service is unavailable', async function () {
        const scope = interceptor.reply(httpStatusCodes.SERVICE_UNAVAILABLE);

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

        const consumePromise = consumeAndProcessFactory(container)();

        const job = await waitForJobToBeResolved(pgBoss, jobId as string);

        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();

        expect(job).toHaveProperty('state', 'failed');
        expect(job).toHaveProperty('output.message', 'Request failed with status code 503');

        scope.done();
      });

      it('should fail the job if tile storage provider storeTile had thrown an error', async function () {
        // const bucket = container.resolve<string>(S3_BUCKET);
        const mapBuffer = await readFile('tests/2048x2048.png');
        const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer);

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

        const error = new Error('storing error');

        const consumePromise = consumeAndProcessFactory(container)();

        const storageProviders = container.resolve<TilesStorageProvider[]>(TILES_STORAGE_PROVIDERS);
        jest.spyOn(storageProviders[0], 'storeTile').mockRejectedValue(error);

        const job = await waitForJobToBeResolved(pgBoss, jobId as string);

        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();

        expect(job).toHaveProperty('state', 'failed');
        expect(job).toHaveProperty('output.message', error.message);

        scope.done();
      });
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

    describe('happy path', function () {
      it('should complete a single job', async function () {
        const mapBuffer = await readFile('tests/512x512.png');
        const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer);

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

        const consumePromise = consumeAndProcessFactory(container)();

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
            const expectedBuffer = await readFile(`tests/integration/expected/${key}`);
            expect(expectedBuffer.compare(storeCall.buffer)).toBe(0);
          }
        }

        scope.done();
      });
    });

    describe('bad path', function () {
      it('should fail the job if map fetching service returns an error', async function () {
        const mapUrl = container.resolve<string>(MAP_URL);
        const scope = nock(mapUrl).get(/.*/).replyWithError({ message: 'fetching map error' });

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

        const consumePromise = consumeAndProcessFactory(container)();

        const job = await waitForJobToBeResolved(pgBoss, jobId as string);

        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();

        expect(job).toHaveProperty('state', 'failed');
        expect(job).toHaveProperty('output.message', 'fetching map error');

        scope.done();
      });

      it('should fail the job if map fetching service returns an ok with xml content type', async function () {
        const mapUrl = container.resolve<string>(MAP_URL);
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const scope = nock(mapUrl).get(/.*/).reply(200, '<xml></xml>', { 'content-type': 'text/xml' });

        const pgBoss = container.resolve(PgBoss);
        const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
        const queueName = container.resolve<string>(QUEUE_NAME);
        const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

        const consumePromise = consumeAndProcessFactory(container)();

        const job = await waitForJobToBeResolved(pgBoss, jobId as string);

        await provider.stopQueue();

        await expect(consumePromise).resolves.not.toThrow();

        expect(job).toHaveProperty('state', 'failed');
        expect(job).toHaveProperty('output.message', 'The response returned from the service was in xml format');

        scope.done();
      });
    });
  });
});
