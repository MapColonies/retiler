import jsLogger from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { PgBossJobQueueProvider } from '../../../src/retiler/jobQueueProvider/pgBossJobQueue'

describe('PgBossJobQueueProvider', () => {
    let provider: PgBossJobQueueProvider;
    let pgbossMock: { on: jest.Mock, start: jest.Mock, stop: jest.Mock, getQueueSize: jest.Mock, complete: jest.Mock, fail: jest.Mock };

    beforeAll(() => {
        pgbossMock = {
            on: jest.fn(),
            start: jest.fn(),
            stop: jest.fn(),
            getQueueSize: jest.fn(),
            complete: jest.fn(),
            fail: jest.fn(),
        }
    })
    beforeEach(function () {
        provider = new PgBossJobQueueProvider(pgbossMock as unknown as PgBoss, jsLogger({ enabled: false }), 'queue-name');
    });
    afterEach(function () {
        jest.clearAllMocks();
    });

    it('should start pg-boss', async () => {
        await expect(provider.startQueue()).resolves.not.toThrow();
    });

    it('should stop the queue', async () => {
        await expect(provider.stopQueue()).resolves.not.toThrow();
    });

    it('should return true if the queue is empty', async () => {
        pgbossMock.getQueueSize.mockResolvedValue(0);
        await expect(provider.isEmpty()).resolves.toBe(true);
    });

    it('should return false if the queue is not empty', async () => {
        pgbossMock.getQueueSize.mockResolvedValue(1);
        await expect(provider.isEmpty()).resolves.toBe(false);
    });

    it('should complete with no errors if none were thrown', async () => {
        pgbossMock.complete.mockResolvedValue(undefined);
        const promise = provider.complete("someId");
        await expect(promise).resolves.not.toThrow();
    });

    it('should complete with no errors and pass the given object argument if none were thrown', async () => {
        pgbossMock.complete.mockResolvedValue(undefined);
        const id = "someId";
        const obj = { key: "value"};

        const promise = provider.complete(id, obj);
        await expect(promise).resolves.not.toThrow();
        expect(pgbossMock.complete).toHaveBeenCalledWith(id, obj);
    });

    it('should reject with an error if complete rejected with an error', async () => {
        pgbossMock.complete.mockRejectedValue(new Error("fatal error"));
        const promise = provider.complete("someId");
        await expect(promise).rejects.toThrow(Error);
    });

    it('should call for a fail with no errors if none were thrown', async () => {
        pgbossMock.fail.mockResolvedValue(undefined);
        const promise = provider.fail("someId", { key: "value" });
        await expect(promise).resolves.not.toThrow();
    });

    it('should fail with no errors and pass the given object argument if none were thrown', async () => {
        pgbossMock.fail.mockResolvedValue(undefined);
        const id = "someId";
        const obj = { key: "value"};

        const promise = provider.fail(id, obj);
        await expect(promise).resolves.not.toThrow();
        expect(pgbossMock.fail).toHaveBeenCalledWith(id, obj);
    });

    it('should reject with an error if fail rejected with an error', async () => {
        pgbossMock.fail.mockRejectedValue(new Error("fatal error"));
        const promise = provider.fail("someId", { key: "value" });
        await expect(promise).rejects.toThrow(Error);
    });
})
