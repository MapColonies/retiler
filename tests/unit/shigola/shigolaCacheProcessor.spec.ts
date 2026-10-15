import type { AxiosInstance } from 'axios';
import { Registry } from 'prom-client';
import { SpanStatusCode } from '@opentelemetry/api';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { NonRetryableError } from '../../../src/common/errors';
import { ShigolaCacheProcessor } from '../../../src/retiler/shigola/shigolaCacheProcessor';
import type { ShigolaConfig } from '../../../src/retiler/shigola/types';

jest.mock('axios');

const MAP_URL = 'http://shigola-admin:9090';

let logger: Logger;

beforeAll(async () => {
  logger = await jsLogger({ enabled: false });
});

function httpError(status: number | undefined, data?: unknown, code?: string): Error {
  return Object.assign(new Error(status === undefined ? `failed with ${code}` : `Request failed with status code ${status}`), {
    isAxiosError: true,
    code,
    ...(status !== undefined && { response: { status, data } }),
  });
}

describe('shigolaCacheProcessor', () => {
  describe('#processTile', () => {
    const post = jest.fn();
    const mockedClient = { post } as unknown as jest.Mocked<AxiosInstance>;
    const span = { setAttribute: jest.fn(), setAttributes: jest.fn(), setStatus: jest.fn(), recordException: jest.fn(), end: jest.fn() };
    const tracerMock = {
      startActiveSpan: jest.fn().mockImplementation((_name: string, _options: unknown, fn: (span: unknown) => unknown) => fn(span)),
      startSpan: jest.fn(),
    };
    let registry: Registry;

    const purgeConfig: ShigolaConfig = { operation: 'purge', targets: [{ map: 'osm' }], timeoutMs: 70000 };

    function createProcessor(config: ShigolaConfig = purgeConfig, url = MAP_URL): ShigolaCacheProcessor {
      return new ShigolaCacheProcessor(mockedClient, logger, tracerMock, url, config, registry, [1]);
    }

    async function metricValue(name: string, labels: Record<string, string>): Promise<number | undefined> {
      const metric = await registry.getSingleMetric(name)?.get();
      return metric?.values.find((v) => Object.entries(labels).every(([key, value]) => String(v.labels[key]) === value))?.value;
    }

    beforeEach(function () {
      registry = new Registry();
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should purge the metatile bbox at its zoom once, without overwrite or a token', async function () {
      post.mockResolvedValue({ status: 200, data: { purged: 4, skipped: 0, failed: 0, durationMs: 3 } });

      await createProcessor().processTile({ z: 2, x: 1, y: 0, metatile: 2, parent: 'parent' });

      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith(
        'http://shigola-admin:9090/cache/purge',
        { bounds: [-90, 0, 0, 90], zoomRange: { min: 2, max: 2 }, targets: [{ map: 'osm' }] },
        { timeout: 70000 }
      );
      await expect(metricValue('retiler_shigola_requests_count', { operation: 'purge', outcome: 'completed', code: '200' })).resolves.toBe(1);
      await expect(metricValue('retiler_shigola_tiles_count', { operation: 'purge', result: 'done' })).resolves.toBe(4);
      expect(span.setAttribute).toHaveBeenCalledWith('shigola.outcome', 'completed');
      expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(span.end).toHaveBeenCalled();
    });

    it('should seed with overwrite, several targets, tile matrix sets and the bearer token', async function () {
      post.mockResolvedValue({ status: 200, data: { seeded: 1, skipped: 0, failed: 0, durationMs: 1 } });
      const config: ShigolaConfig = {
        operation: 'seed',
        targets: [{ map: 'osm' }, { map: 'light' }],
        tileMatrixSets: ['WorldCRS84Quad'],
        token: 'secret',
        timeoutMs: 1000,
      };

      await createProcessor(config, 'http://shigola-admin:9090/admin/').processTile({ z: 1, x: 3, y: 1, metatile: 1 });

      expect(post).toHaveBeenCalledWith(
        'http://shigola-admin:9090/admin/cache/seed',
        {
          bounds: [90, -90, 180, 0],
          zoomRange: { min: 1, max: 1 },
          targets: [{ map: 'osm' }, { map: 'light' }],
          tileMatrixSets: ['WorldCRS84Quad'],
          overwrite: true,
        },
        { timeout: 1000, headers: { authorization: 'Bearer secret' } }
      );
    });

    it('should send purge targets with their layers', async function () {
      post.mockResolvedValue({ status: 200, data: { purged: 1, skipped: 0, failed: 0, durationMs: 1 } });

      await createProcessor({ ...purgeConfig, targets: [{ map: 'osm', layers: ['roads'] }] }).processTile({ z: 0, x: 0, y: 0, metatile: 1 });

      expect(post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ targets: [{ map: 'osm', layers: ['roads'] }] }),
        expect.anything()
      );
    });

    it('should omit an empty token', async function () {
      post.mockResolvedValue({ status: 200, data: { purged: 1, skipped: 0, failed: 0, durationMs: 1 } });

      await createProcessor({ ...purgeConfig, token: '' }).processTile({ z: 0, x: 0, y: 0, metatile: 1 });

      expect(post).toHaveBeenCalledWith(expect.any(String), expect.anything(), { timeout: 70000 });
    });

    it('should clamp a metatile reaching past the grid to valid lng/lat bounds', async function () {
      post.mockResolvedValue({ status: 200, data: { purged: 2, skipped: 0, failed: 0, durationMs: 1 } });

      await createProcessor().processTile({ z: 0, x: 0, y: 0, metatile: 8 });

      expect(post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ bounds: [-180, -90, 180, 90], zoomRange: { min: 0, max: 0 } }),
        expect.anything()
      );
    });

    it.each([
      ['400 bad bbox', 400, { error: 'bounds [...] are not a west, south, east, north lng/lat box' }],
      ['400 from a proxy', 400, '<html>Bad Request</html>'],
      ['422 too many tiles', 422, { error: 'request covers more than max_tiles_per_request' }],
    ])('should reject without retry on %s', async function (_name, status, body) {
      post.mockRejectedValue(httpError(status, body));

      const promise = createProcessor().processTile({ z: 0, x: 0, y: 0, metatile: 1 });

      await expect(promise).rejects.toBeInstanceOf(NonRetryableError);
      await expect(promise).rejects.toThrow(`status ${status}`);
      await expect(metricValue('retiler_shigola_requests_count', { outcome: 'rejected', code: String(status) })).resolves.toBe(1);
      expect(span.setAttribute).toHaveBeenCalledWith('shigola.outcome', 'rejected');
      expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    });

    it.each([
      ['401 missing token', httpError(401, { error: 'unauthorized' }), '401'],
      ['403 forbidden', httpError(403, undefined), '403'],
      ['404 wrong admin url', httpError(404, '404 page not found'), '404'],
      ['429 busy', httpError(429, { error: 'busy' }), '429'],
      ['500 failed tile', httpError(500, { purged: 1, skipped: 0, failed: 1, durationMs: 1 }), '500'],
      ['503 timed out', httpError(503, { purged: 1, skipped: 0, failed: 0, durationMs: 60000 }), '503'],
      ['client timeout', httpError(undefined, undefined, 'ECONNABORTED'), 'none'],
      ['connection error', httpError(undefined, undefined, 'ECONNREFUSED'), 'none'],
    ])('should fail for a retry on %s', async function (_name, error, status) {
      post.mockRejectedValue(error);

      const promise = createProcessor().processTile({ z: 0, x: 0, y: 0, metatile: 1 });

      await expect(promise).rejects.toBe(error);
      await expect(promise).rejects.not.toBeInstanceOf(NonRetryableError);
      await expect(metricValue('retiler_shigola_requests_count', { outcome: 'failed', code: status })).resolves.toBe(1);
    });

    it('should complete a 2xx that reports failed tiles, counting them', async function () {
      post.mockResolvedValue({ status: 200, data: { purged: 3, skipped: 1, failed: 1, durationMs: 1 } });

      await expect(createProcessor().processTile({ z: 0, x: 0, y: 0, metatile: 1 })).resolves.toBeUndefined();

      await expect(metricValue('retiler_shigola_requests_count', { outcome: 'completed', code: '200' })).resolves.toBe(1);
      await expect(metricValue('retiler_shigola_tiles_count', { result: 'failed' })).resolves.toBe(1);
      await expect(metricValue('retiler_shigola_tiles_count', { result: 'skipped' })).resolves.toBe(1);
      expect(span.setAttributes).toHaveBeenCalledWith(expect.objectContaining({ 'shigola.tiles.failed': 1 }));
    });

    it('should work without a metrics registry', async function () {
      post.mockResolvedValue({ status: 200, data: { purged: 1, skipped: 0, failed: 0, durationMs: 1 } });
      const provider = new ShigolaCacheProcessor(mockedClient, logger, tracerMock, MAP_URL, purgeConfig);

      await expect(provider.processTile({ z: 0, x: 0, y: 0, metatile: 1 })).resolves.toBeUndefined();
    });
  });
});
