import jsLogger from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { PgBossJobQueueProvider } from '../../../src/retiler/jobQueueProvider/pgBossJobQueue';
import { setTimeout } from 'timers/promises';

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
    provider = new PgBossJobQueueProvider(pgbossMock as unknown as PgBoss, jsLogger({ enabled: true }), 'queue-name', 50);
  });

  afterEach(function () {
    jest.clearAllMocks();
  });

  describe('#startQueue', () => {
    it('should start queue provider', async () => {
      await expect(provider.startQueue()).resolves.not.toThrow();
    });

    it('should throw if trying to start a started queue', async () => {
      await provider.startQueue();
      await expect(provider.startQueue()).rejects.toThrow();
    });
  });

  describe('#stopQueue', () => {
    it('should stop the queue provider', async () => {
      await provider.startQueue();
      await expect(provider.stopQueue()).resolves.not.toThrow();
    });

    it('should throw if the queue is stopped when it was never started', async () => {
      await expect(provider.stopQueue()).rejects.toThrow();
    });
  });

  describe('#activeQueueName', () => {
    it('should return the queue name', () => {
      expect(provider.activeQueueName).toBe('queue-name');
    });
  });

  describe.only('#consumeQueue', () => {
    // it('should not iterate on any jobs if no jobs were fetched', async () => {
    //   pgbossMock.fetch.mockResolvedValue(null);
    //   await expect(provider.consumeQueue(jest.fn())).resolves.not.toThrow();
    // });

    it.only('should consume the queue and call the provided funcs', async () => {
      const job1 = { id: 'id1', data: { key: 'value' } };
      const job2 = { id: 'id2', data: { key: 'value' } };

      const fnMock = jest.fn().mockImplementation(async () => {
        await setTimeout(100);
      });
      // pgbossMock.fetch.mockResolvedValueOnce(job1).mockResolvedValueOnce(job2).mockResolvedValue(null);
      pgbossMock.fetch.mockResolvedValue(job1);
      await provider.startQueue();
      const queuePromise = provider.consumeQueue(fnMock);
      await provider.stopQueue();

      await expect(queuePromise).resolves.not.toThrow();

      expect(fnMock).toHaveBeenCalledTimes(2);
      expect(pgbossMock.complete).toHaveBeenCalled();
      expect(pgbossMock.fail).not.toHaveBeenCalled();
    }, 999999);

    it('should consume the queue in parallel when enabled', async () => {
      const job1 = { id: 'id1', data: { key: 'value' } };
      const job2 = { id: 'id2', data: { key: 'value' } };
      const job3 = { id: 'id3', data: { key: 'value' } };

      const fnMock = jest.fn();
      pgbossMock.fetch.mockResolvedValueOnce(job1).mockResolvedValueOnce(job2).mockResolvedValueOnce(job3).mockResolvedValueOnce(null);

      await expect(provider.consumeQueue(fnMock, 2)).resolves.not.toThrow();

      expect(fnMock).toHaveBeenCalledTimes(3);
      expect(pgbossMock.complete).toHaveBeenCalled();
      expect(pgbossMock.fail).not.toHaveBeenCalled();
    });

    it('should reject with an error if provided function for consuming has failed', async () => {
      const id = 'someId';
      pgbossMock.fetch.mockResolvedValueOnce({ id });

      const fnMock = jest.fn();
      const fetchError = new Error('fetch error');
      fnMock.mockRejectedValue(fetchError);

      await expect(provider.consumeQueue(fnMock)).resolves.not.toThrow();

      expect(pgbossMock.complete).not.toHaveBeenCalled();
      expect(pgbossMock.fail).toHaveBeenCalledWith(id, fetchError);
    });
  });
});
