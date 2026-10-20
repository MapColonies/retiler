import type { IDetilerClient } from '@map-colonies/detiler-client';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import type { AxiosInstance } from 'axios';
import { Registry } from 'prom-client';
import type { ConfigType } from '../../src/common/config';
import { CachePurgerTileProcessor } from '../../src/retiler/cachePurgerTileProcessor';

let logger: Logger;

beforeAll(async () => {
  logger = await jsLogger({ enabled: false });
});

describe('CachePurgerTileProcessor', () => {
  const sendPurgeRequest = jest.fn();
  const getTileDetails = jest.fn();
  const setTileDetails = jest.fn();

  const configMock = {
    get: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'app.project':
          return { name: 'testKit', stateUrl: 'stateUrlTest' };
        case 'detiler.proceedOnFailure':
          return true;
        default:
          return;
      }
    }),
    has: jest.fn(),
  } as unknown as ConfigType;

  let processor: CachePurgerTileProcessor;

  beforeEach(function () {
    const tracerMock = {
      startActiveSpan: jest
        .fn()
        .mockImplementation((_name: string, _options: unknown, fn: (span: unknown) => unknown) =>
          fn({ setStatus: jest.fn(), recordException: jest.fn(), end: jest.fn(), setAttribute: jest.fn(), setAttributes: jest.fn() })
        ),
      startSpan: jest.fn(),
    };
    const mockedDetiler: IDetilerClient = {
      getTileDetails,
      setTileDetails,
      getKits: jest.fn(),
      queryTilesDetails: jest.fn(),
      queryTilesDetailsAsyncGenerator: jest.fn(),
      queryCooldownsAsyncGenerator: jest.fn(),
      getTilesDetails: jest.fn(),
    };

    processor = new CachePurgerTileProcessor(
      logger,
      tracerMock,
      { sendPurgeRequest },
      { get: jest.fn() } as unknown as AxiosInstance,
      configMock,
      mockedDetiler,
      new Registry(),
      []
    );
  });

  afterEach(function () {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('#processTile', () => {
    it('should purge the cache and set the tile as rendered', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8, state: 2 };
      jest.spyOn(Date, 'now').mockImplementation(() => 1705487516000);
      getTileDetails.mockResolvedValue(null);
      sendPurgeRequest.mockResolvedValue(undefined);

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(sendPurgeRequest).toHaveBeenCalledWith(tile);
      expect(setTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 }, { status: 'rendered', state: 2, timestamp: 1705487516 });
    });

    it('should throw and skip post processing if purging the cache has failed', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      const error = new Error('purge failed');
      getTileDetails.mockResolvedValue(null);
      sendPurgeRequest.mockRejectedValue(error);

      await expect(processor.processTile(tile)).rejects.toThrow(error);

      expect(setTileDetails).not.toHaveBeenCalled();
    });
  });
});
