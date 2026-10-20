import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { HttpCachePurger, type CachePurgerConfig, type PurgeRequest } from '../../../src/retiler/cachePurger/httpCachePurger';

let logger: Logger;

beforeAll(async () => {
  logger = await jsLogger({ enabled: false });
});

const createPurgerConfig = (url: string, token?: string): CachePurgerConfig => ({ url, map: 'testMap', token, timeoutMs: 1000 });

describe('httpCachePurger', () => {
  describe('#sendPurgeRequest', () => {
    let mockedClient: jest.Mocked<AxiosInstance>;

    beforeEach(function () {
      mockedClient = { post: jest.fn() } as unknown as jest.Mocked<AxiosInstance>;
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should post a purge request for the metatile bounds on its zoom level', async function () {
      const purger = new HttpCachePurger(mockedClient, logger, createPurgerConfig('http://cache-admin.com'));
      mockedClient.post.mockResolvedValue({ data: { purged: 4, skipped: 0, failed: 0, durationMs: 1 } });

      await purger.sendPurgeRequest({ z: 1, x: 0, y: 0, metatile: 2, parent: 'parent' });

      expect(mockedClient.post.mock.calls).toHaveLength(1);
      const [url, body, requestConfig] = mockedClient.post.mock.calls[0]! as [string, PurgeRequest, AxiosRequestConfig];
      expect(url).toBe('http://cache-admin.com/cache/purge');
      expect(body).toStrictEqual({
        bounds: [-180, -90, 0, 90],
        zoomRange: { min: 1, max: 1 },
        targets: [{ map: 'testMap' }],
      });
      expect(requestConfig).toStrictEqual({ timeout: 1000, headers: undefined });
    });

    it('should send the token as a bearer authorization header', async function () {
      const purger = new HttpCachePurger(mockedClient, logger, createPurgerConfig('http://cache-admin.com', 'secret'));
      mockedClient.post.mockResolvedValue({ data: { purged: 1, skipped: 0, failed: 0, durationMs: 1 } });

      await purger.sendPurgeRequest({ z: 0, x: 0, y: 0, metatile: 1 });

      const requestConfig = mockedClient.post.mock.calls[0]![2];
      expect(requestConfig).toStrictEqual({ timeout: 1000, headers: { authorization: 'Bearer secret' } });
    });

    it('should clamp metatile bounds to the tile grid', async function () {
      const purger = new HttpCachePurger(mockedClient, logger, createPurgerConfig('http://cache-admin.com'));
      mockedClient.post.mockResolvedValue({ data: { purged: 1, skipped: 0, failed: 0, durationMs: 1 } });

      await purger.sendPurgeRequest({ z: 0, x: 0, y: 0, metatile: 8 });

      const body = mockedClient.post.mock.calls[0]![1] as PurgeRequest;
      expect(body.bounds).toStrictEqual([-180, -90, 180, 90]);
    });

    it('should keep the base url path and drop a trailing slash', async function () {
      const purger = new HttpCachePurger(mockedClient, logger, createPurgerConfig('http://cache.com/admin/'));
      mockedClient.post.mockResolvedValue({ data: { purged: 1, skipped: 0, failed: 0, durationMs: 1 } });

      await purger.sendPurgeRequest({ z: 0, x: 0, y: 0, metatile: 1 });

      expect(mockedClient.post.mock.calls[0]![0]).toBe('http://cache.com/admin/cache/purge');
    });

    it('should throw an error if the request has failed', async function () {
      const purger = new HttpCachePurger(mockedClient, logger, createPurgerConfig('http://cache-admin.com'));
      const error = new Error('request failed');
      mockedClient.post.mockRejectedValue(error);

      await expect(purger.sendPurgeRequest({ z: 0, x: 0, y: 0, metatile: 1 })).rejects.toThrow(error);
    });
  });
});
