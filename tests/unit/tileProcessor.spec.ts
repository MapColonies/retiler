import { readFile } from 'fs/promises';
import { IDetilerClient } from '@map-colonies/detiler-client';
import jsLogger from '@map-colonies/js-logger';
import config from 'config';
import { AxiosInstance } from 'axios';
import client from 'prom-client';
import { MapProvider, MapSplitterProvider, TilesStorageProvider } from '../../src/retiler/interfaces';
import { TileProcessor } from '../../src/retiler/tileProcessor';
import { timestampToUnix } from '../../src/common/util';
import { MILLISECONDS_IN_SECOND } from '../../src/common/constants';

const REMOTE_STATE_TIMESTAMP = '2024-01-15T21:20:36Z';

describe('TileProcessor', () => {
  let processor: TileProcessor;
  let processorWithMultiStores: TileProcessor;
  let mapProv: MapProvider;
  let mapSplitterProv: MapSplitterProvider;
  let tilesStorageProv: TilesStorageProvider;
  let anotherTilesStorageProv: TilesStorageProvider;
  let mockedClient: jest.Mocked<AxiosInstance>;
  let mockedDetiler: IDetilerClient;

  describe('#processTile', () => {
    const getMap = jest.fn();
    const splitMap = jest.fn();
    const storeTile = jest.fn();
    const storeTiles = jest.fn();
    const getTileDetails = jest.fn();
    const setTileDetails = jest.fn();

    const configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'app.project':
            return {
              name: 'testKit',
              stateUrl: 'stateUrlTest',
            };
          default:
            return config.get<unknown>(key);
        }
      }),
      has: jest.fn(),
    };

    beforeEach(function () {
      mapProv = {
        getMap,
      };

      mapSplitterProv = {
        splitMap,
      };

      tilesStorageProv = {
        storeTile,
        storeTiles,
      };

      anotherTilesStorageProv = {
        storeTile,
        storeTiles,
      };

      mockedClient = { get: jest.fn() } as unknown as jest.Mocked<AxiosInstance>;
      mockedDetiler = {
        getTileDetails,
        setTileDetails,
        getKits: jest.fn(),
        queryTilesDetails: jest.fn(),
        queryTilesDetailsAsyncGenerator: jest.fn(),
        getTilesDetails: jest.fn(),
      };

      processor = new TileProcessor(
        jsLogger({ enabled: false }),
        mapProv,
        mapSplitterProv,
        [tilesStorageProv],
        mockedClient,
        configMock,
        mockedDetiler,
        new client.Registry(),
        []
      );

      processorWithMultiStores = new TileProcessor(
        jsLogger({ enabled: false }),
        mapProv,
        mapSplitterProv,
        [tilesStorageProv, anotherTilesStorageProv],
        mockedClient,
        configMock,
        mockedDetiler,
        new client.Registry(),
        []
      );
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should call all the processing functions in a row and resolve without errors', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8, state: 2 };

      jest.spyOn(Date, 'now').mockImplementation(() => 1705487516000);
      getTileDetails.mockResolvedValue({ kit: 'testKit', updatedAt: 10, state: 1, createdAt: 10, updateCount: 1, location: '31.1,32.3' });
      const remoteStateResponse = await readFile('tests/state.txt');
      mockedClient.get.mockResolvedValue({ data: remoteStateResponse });

      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(1);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 }, { state: 2, timestamp: 1705487516 });
    });

    it('should call all the processing functions in a row and resolve without errors if detiler is not configured', async () => {
      const processor = new TileProcessor(
        jsLogger({ enabled: false }),
        mapProv,
        mapSplitterProv,
        [tilesStorageProv],
        mockedClient,
        configMock,
        undefined,
        new client.Registry(),
        []
      );

      const tile = { x: 0, y: 0, z: 0, metatile: 8, state: 2 };

      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).not.toHaveBeenCalled();
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).not.toHaveBeenCalled();
    });

    it('should skip processing due to detiler detail response having greater updated time', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };

      const updatedAtUnix = timestampToUnix(REMOTE_STATE_TIMESTAMP) + 1000000;
      getTileDetails.mockResolvedValue({ kit: 'testKit', updatedAt: updatedAtUnix, state: 1, createdAt: 0, updateCount: 1, location: '31.1,32.3' });
      const remoteStateResponse = await readFile('tests/state.txt');
      mockedClient.get.mockResolvedValue({ data: remoteStateResponse });

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(1);
      expect(mapProv.getMap).not.toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).not.toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).not.toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).not.toHaveBeenCalled();
    });

    it('should call all the processing functions in a row with the exception of detiler if tile is attributed with force', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8, force: true };

      const newUpdatedAt = timestampToUnix(REMOTE_STATE_TIMESTAMP);
      jest.spyOn(Date, 'now').mockImplementation(() => newUpdatedAt * MILLISECONDS_IN_SECOND);

      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).not.toHaveBeenCalled();
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 }, { state: undefined, timestamp: newUpdatedAt });
    });

    it('should call all the processing functions in a row with the exception of detiler if application is force processing', async () => {
      const configMock = {
        get: jest.fn().mockImplementation((key: string) => {
          switch (key) {
            case 'app.project':
              return {
                name: 'testKit',
                stateUrl: 'stateUrlTest',
              };
            case 'app.forceProcess':
              return true;
          }
        }),
        has: jest.fn(),
      };

      const tileProcessorWithForce = new TileProcessor(
        jsLogger({ enabled: false }),
        mapProv,
        mapSplitterProv,
        [tilesStorageProv, anotherTilesStorageProv],
        mockedClient,
        configMock,
        mockedDetiler,
        new client.Registry(),
        []
      );

      const tile = { x: 0, y: 0, z: 0, metatile: 8 };

      const newUpdatedAt = timestampToUnix(REMOTE_STATE_TIMESTAMP);
      jest.spyOn(Date, 'now').mockImplementation(() => newUpdatedAt * MILLISECONDS_IN_SECOND);

      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(tileProcessorWithForce.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).not.toHaveBeenCalled();
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 }, { state: undefined, timestamp: newUpdatedAt });
    });

    it('should call all the processing functions in a row and resolve without errors for multi stores processor', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };

      jest.spyOn(Date, 'now').mockImplementation(() => 1705487516000);
      getTileDetails.mockResolvedValue({ kit: 'testKit', updatedAt: 10, state: 1, createdAt: 10, updateCount: 1, location: '31.1,32.3' });
      const remoteStateResponse = await readFile('tests/state.txt');
      mockedClient.get.mockResolvedValue({ data: remoteStateResponse });

      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(processorWithMultiStores.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(1);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(anotherTilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 }, { state: undefined, timestamp: 1705487516 });
    });

    it('should call all the processing functions in a row and resolve without errors if pre processing fails by getTileDetails', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      getTileDetails.mockRejectedValue(new Error());
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).toHaveBeenCalled();
    });

    it('should call all the processing functions in a row and resolve without errors if pre processing fails by getting state', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      getTileDetails.mockReturnValue({ updatedAt: 1 });
      mockedClient.get.mockRejectedValue(new Error());
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(1);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).toHaveBeenCalled();
    });

    it('should call all the processing functions in a row and resolve without errors even if post processing fails by setTileDetails', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      getTileDetails.mockResolvedValue(null);
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);
      setTileDetails.mockRejectedValue(new Error());

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).toHaveBeenCalled();
    });

    it('should fail if setTileDetails fails and configured to not proceed on detiler failure', async () => {
      const configMock = {
        get: jest.fn().mockImplementation((key: string) => {
          switch (key) {
            case 'app.project':
              return {
                name: 'testKit',
                stateUrl: 'stateUrlTest',
              };
            case 'detiler.proceedOnFailure':
              return false;
          }
        }),
        has: jest.fn(),
      };

      const tileProcessorWithNoProceeding = new TileProcessor(
        jsLogger({ enabled: false }),
        mapProv,
        mapSplitterProv,
        [tilesStorageProv, anotherTilesStorageProv],
        mockedClient,
        configMock,
        mockedDetiler,
        new client.Registry(),
        []
      );

      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      getTileDetails.mockResolvedValue(null);
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);
      const error = new Error('detiler set error');
      setTileDetails.mockRejectedValue(error);

      await expect(tileProcessorWithNoProceeding.processTile(tile)).rejects.toThrow(error);

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).toHaveBeenCalled();
    });

    it('should throw error if getting map has failed', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      getTileDetails.mockResolvedValue(null);
      const getMapError = new Error('getting map error');
      getMap.mockRejectedValue(getMapError);

      await expect(processor.processTile(tile)).rejects.toThrow(getMapError);

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).not.toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).not.toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).not.toHaveBeenCalled();
    });

    it('should throw error if splitting map has failed', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      getTileDetails.mockResolvedValue(null);
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      const splitMapError = new Error('splitting map error');
      splitMap.mockRejectedValue(splitMapError);

      await expect(processor.processTile(tile)).rejects.toThrow(splitMapError);

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).not.toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).not.toHaveBeenCalled();
    });

    it('should throw error if storing tiles had failed', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      getTileDetails.mockResolvedValue(null);
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);
      const storeTileError = new Error('store tile error');
      storeTiles.mockRejectedValue(storeTileError);

      await expect(processor.processTile(tile)).rejects.toThrow(storeTileError);

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).not.toHaveBeenCalled();
    });

    it('should throw error if storing tiles had failed on at least one of the multi storage processor', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      getTileDetails.mockResolvedValue(null);
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);
      const storeTileError = new Error('store tile error');
      storeTiles.mockResolvedValueOnce(undefined).mockRejectedValue(storeTileError);

      await expect(processorWithMultiStores.processTile(tile)).rejects.toThrow(storeTileError);

      expect(mockedDetiler.getTileDetails).toHaveBeenCalledWith({ kit: 'testKit', x: 0, y: 0, z: 0 });
      expect(mockedClient.get.mock.calls).toHaveLength(0);
      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(anotherTilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(mockedDetiler.setTileDetails).not.toHaveBeenCalled();
    });
  });
});
