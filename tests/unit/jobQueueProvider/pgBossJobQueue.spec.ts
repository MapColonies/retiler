import jsLogger from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { PgBossJobQueueProvider } from '../../../src/retiler/jobQueueProvider/pgBossJobQueue';

describe('PgBossJobQueueProvider', () => {
  let provider: PgBossJobQueueProvider;
  let pgbossMock: {
    on: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
    getQueueSize: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    fetch: jest.Mock;
  };

  beforeAll(() => {
    pgbossMock = {
      on: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      getQueueSize: jest.fn(),
      complete: jest.fn(),
      fail: jest.fn(),
      fetch: jest.fn(),
    };
  });

  beforeEach(function () {
    provider = new PgBossJobQueueProvider(pgbossMock as unknown as PgBoss, jsLogger({ enabled: false }), 'queue-name');
  });

  afterEach(function () {
    jest.clearAllMocks();
  });

  describe('#startQueue', () => {
    it('should start pg-boss', async () => {
      await expect(provider.startQueue()).resolves.not.toThrow();
    });
  });

  describe('#stopQueue', () => {
    it('should stop the queue', async () => {
      await expect(provider.stopQueue()).resolves.not.toThrow();
    });
  });

  describe('#activeQueueName', () => {
    it('should return the queue name', () => {
      expect(provider.activeQueueName).toBe('queue-name');
    });
  });

  describe('#complete', () => {
    it('should complete with no errors if none were thrown', async () => {
      pgbossMock.complete.mockResolvedValue(undefined);
      const promise = provider.complete('someId');
      await expect(promise).resolves.not.toThrow();
    });

    it('should complete with no errors and pass the given object argument if none were thrown', async () => {
      pgbossMock.complete.mockResolvedValue(undefined);
      const id = 'someId';
      const obj = { key: 'value' };

      const promise = provider.complete(id, obj);
      await expect(promise).resolves.not.toThrow();
      expect(pgbossMock.complete).toHaveBeenCalledWith(id, obj);
    });

    it('should reject with an error if complete rejected with an error', async () => {
      pgbossMock.complete.mockRejectedValue(new Error('fatal error'));
      const promise = provider.complete('someId');
      await expect(promise).rejects.toThrow(Error);
    });
  });

  describe('#fail', () => {
    it('should call for a fail with no errors if none were thrown', async () => {
      pgbossMock.fail.mockResolvedValue(undefined);
      const promise = provider.fail('someId', { key: 'value' });
      await expect(promise).resolves.not.toThrow();
    });

    it('should fail with no errors and pass the given object argument if none were thrown', async () => {
      pgbossMock.fail.mockResolvedValue(undefined);
      const id = 'someId';
      const obj = { key: 'value' };

      const promise = provider.fail(id, obj);
      await expect(promise).resolves.not.toThrow();
      expect(pgbossMock.fail).toHaveBeenCalledWith(id, obj);
    });

    it('should reject with an error if fail rejected with an error', async () => {
      pgbossMock.fail.mockRejectedValue(new Error('fatal error'));
      const promise = provider.fail('someId', { key: 'value' });
      await expect(promise).rejects.toThrow(Error);
    });
  });

  describe('#iterateJobs', () => {
    it('should not iterate on any jobs if no jobs were fetched', async () => {
      pgbossMock.fetch.mockResolvedValue(null);
      const jobGenerator = provider.iterateJobs();

      await expect(jobGenerator.next()).resolves.toHaveProperty('value', undefined);
    });

    it('should iterate on jobs until there are no jobs fetch', async () => {
      const id = 'someId';
      const obj = { key: 'value' };

      pgbossMock.fetch.mockResolvedValueOnce({ id, data: obj });
      const jobGenerator = provider.iterateJobs();
      await expect(jobGenerator.next()).resolves.toHaveProperty('value', { id, data: obj });

      pgbossMock.fetch.mockResolvedValueOnce(null);
      await expect(jobGenerator.next()).resolves.toHaveProperty('value', undefined);
    });

    it('should reject with an error if fetch has failed', async () => {
      const fetchError = new Error('fetch error');
      pgbossMock.fetch.mockRejectedValue(fetchError);

      const jobGenerator = provider.iterateJobs();

      await expect(jobGenerator.next()).rejects.toThrow(fetchError);
    });
  });
});
