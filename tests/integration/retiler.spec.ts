import { readFile } from 'fs/promises';
import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import PgBoss from 'pg-boss';
import nock from 'nock';
import httpStatusCodes from 'http-status-codes';
import { S3Client } from '@aws-sdk/client-s3';
import { registerExternalValues } from '../../src/containerConfig';
import { consumeAndProcessFactory } from '../../src/app';
import { ShutdownHandler } from '../../src/common/shutdownHandler';
import { MAP_URL, QUEUE_NAME, S3_BUCKET, SERVICES, TILES_STORAGE_LAYOUT } from '../../src/common/constants';

describe('retiler', function () {
  let container: DependencyContainer;
  let interceptor: nock.Interceptor;

  beforeAll(async () => {
    container = await registerExternalValues({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        { token: TILES_STORAGE_LAYOUT, provider: { useValue: { format: '{z}/{x}/{y}.png', shouldFlipY: true } } },
      ],
      useChild: true,
    });

    const mapUrl = container.resolve<string>(MAP_URL);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    interceptor = nock(mapUrl).defaultReplyHeaders({ 'content-type': 'image/png' }).get(/.*/);
  });

  afterEach(async () => {
    const pgBoss = container.resolve(PgBoss);
    await pgBoss.clearStorage();

    nock.removeInterceptor(interceptor);
  });

  afterAll(async () => {
    const shutdownhandler = container.resolve(ShutdownHandler);
    await shutdownhandler.shutdown();
    container.reset();
  });

  describe('Happy Path', function () {
    it('should complete a single job', async function () {
      const mapBuffer = await readFile('tests/512x512.png');
      const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer);

      const s3Client = container.resolve<S3Client>(SERVICES.S3);
      const s3SendSpy = jest.spyOn(s3Client, 'send');

      const pgBoss = container.resolve(PgBoss);
      const queueName = container.resolve<string>(QUEUE_NAME);
      const jobId = await pgBoss.send({ name: queueName, data: { z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' } });

      await consumeAndProcessFactory(container)();

      const job = await pgBoss.getJobById(jobId as string);

      expect(job).toHaveProperty('state', 'completed');

      expect(s3SendSpy.mock.calls).toHaveLength(4);

      for (let i = 0; i < 4; i++) {
        const test = s3SendSpy.mock.calls[i][0] as PutObjectCommand;
        const expectedBuffer = await readFile(`tests/integration/expected/${test.input.Key as string}`);
        expect(expectedBuffer.compare(test.input.Body as Buffer)).toBe(0);
      }

      scope.done();
    });

    it('should complete multiple jobs', async function () {
      const mapBuffer = await readFile('tests/2048x2048.png');
      const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer).persist();

      const pgBoss = container.resolve(PgBoss);
      const queueName = container.resolve<string>(QUEUE_NAME);
      const request1 = { name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } };
      const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } };
      const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };

      const [jobId1, jobId2, jobId3] = await Promise.all([pgBoss.send(request1), pgBoss.send(request2), pgBoss.send(request3)]);

      await consumeAndProcessFactory(container)();

      const [job1, job2, job3] = await Promise.all([
        pgBoss.getJobById(jobId1 as string),
        pgBoss.getJobById(jobId2 as string),
        pgBoss.getJobById(jobId3 as string),
      ]);

      expect(job1).toHaveProperty('state', 'completed');
      expect(job2).toHaveProperty('state', 'completed');
      expect(job3).toHaveProperty('state', 'completed');

      scope.done();
    });

    it('should complete some jobs even when one fails', async function () {
      const mapBuffer = await readFile('tests/2048x2048.png');
      const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer).persist();

      const pgBoss = container.resolve(PgBoss);
      const queueName = container.resolve<string>(QUEUE_NAME);
      const request1 = { name: queueName, data: { z: 0, x: 10, y: 10, metatile: 8, parent: 'parent' } };
      const request2 = { name: queueName, data: { z: 1, x: 0, y: 0, metatile: 8, parent: 'parent' } };
      const request3 = { name: queueName, data: { z: 2, x: 0, y: 0, metatile: 8, parent: 'parent' } };

      const [jobId1, jobId2, jobId3] = await Promise.all([pgBoss.send(request1), pgBoss.send(request2), pgBoss.send(request3)]);

      await consumeAndProcessFactory(container)();

      const [job1, job2, job3] = await Promise.all([
        pgBoss.getJobById(jobId1 as string),
        pgBoss.getJobById(jobId2 as string),
        pgBoss.getJobById(jobId3 as string),
      ]);

      expect(job1).toHaveProperty('state', 'failed');
      expect(job1).toHaveProperty('output.message', 'x index out of range of tile grid');
      expect(job2).toHaveProperty('state', 'completed');
      expect(job3).toHaveProperty('state', 'completed');

      scope.done();
    });

    it('should resolve without errors if queue is empty', async function () {
      const pgBoss = container.resolve(PgBoss);
      const queueName = container.resolve<string>(QUEUE_NAME);

      const queueSizeBefore = await pgBoss.getQueueSize(queueName);
      const promise = consumeAndProcessFactory(container)();
      const queueSizeAfter = await pgBoss.getQueueSize(queueName);

      expect(queueSizeBefore).toBe(0);
      await expect(promise).resolves.not.toThrow();
      expect(queueSizeAfter).toBe(0);
    });
  });

  describe('Bad Path', function () {
    it('should fail the job if the tile is out of bounds', async function () {
      const pgBoss = container.resolve(PgBoss);
      const queueName = container.resolve<string>(QUEUE_NAME);
      const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 10, y: 10, metatile: 8, parent: 'parent' } });

      await consumeAndProcessFactory(container)();

      const job = await pgBoss.getJobById(jobId as string);
      expect(job).toHaveProperty('state', 'failed');
      expect(job).toHaveProperty('output.message', 'x index out of range of tile grid');
    });

    it('should fail the job if map fetching service returns an error', async function () {
      const mapUrl = container.resolve<string>(MAP_URL);
      const scope = nock(mapUrl).get(/.*/).replyWithError({ message: 'fetching map error' });

      const pgBoss = container.resolve(PgBoss);
      const queueName = container.resolve<string>(QUEUE_NAME);
      const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

      await consumeAndProcessFactory(container)();

      const job = await pgBoss.getJobById(jobId as string);

      expect(job).toHaveProperty('state', 'failed');
      expect(job).toHaveProperty('output.message', 'fetching map error');

      scope.done();
    });

    it('should fail the job if map fetching service is unavailable', async function () {
      const scope = interceptor.reply(httpStatusCodes.SERVICE_UNAVAILABLE);

      const pgBoss = container.resolve(PgBoss);
      const queueName = container.resolve<string>(QUEUE_NAME);
      const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

      await consumeAndProcessFactory(container)();

      const job = await pgBoss.getJobById(jobId as string);

      expect(job).toHaveProperty('state', 'failed');
      expect(job).toHaveProperty('output.message', 'Request failed with status code 503');

      scope.done();
    });

    it('should fail the job if s3 send had thrown an error', async function () {
      const bucket = container.resolve<string>(S3_BUCKET);
      const mapBuffer = await readFile('tests/2048x2048.png');
      const scope = interceptor.reply(httpStatusCodes.OK, mapBuffer);

      const pgBoss = container.resolve(PgBoss);
      const queueName = container.resolve<string>(QUEUE_NAME);
      const jobId = await pgBoss.send({ name: queueName, data: { z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' } });

      const errorMessage = 's3 error';
      const s3Client = container.resolve<S3Client>(SERVICES.S3);
      jest.spyOn(s3Client, 'send').mockRejectedValue(new Error(errorMessage) as never);

      await consumeAndProcessFactory(container)();

      const job = await pgBoss.getJobById(jobId as string);

      expect(job).toHaveProperty('state', 'failed');
      expect(job).toHaveProperty('output.message', `an error occurred during the put of key 0/0/0.png on bucket ${bucket}, ${errorMessage}`);

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
