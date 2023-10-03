import jsLogger from '@map-colonies/js-logger';
import client from 'prom-client';
import { MapProvider, MapSplitterProvider, TilesStorageProvider } from '../../src/retiler/interfaces';
import { TileProcessor } from '../../src/retiler/tileProcessor';

describe('TileProcessor', () => {
  let processor: TileProcessor;
  let processorWithMultiStores: TileProcessor;
  let mapProv: MapProvider;
  let mapSplitterProv: MapSplitterProvider;
  let tilesStorageProv: TilesStorageProvider;
  let anotherTilesStorageProv: TilesStorageProvider;

  describe('#processTile', () => {
    const getMap = jest.fn();
    const splitMap = jest.fn();
    const storeTile = jest.fn();
    const storeTiles = jest.fn();

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

      processor = new TileProcessor(jsLogger({ enabled: false }), mapProv, mapSplitterProv, [tilesStorageProv], new client.Registry(), []);
      processorWithMultiStores = new TileProcessor(
        jsLogger({ enabled: false }),
        mapProv,
        mapSplitterProv,
        [tilesStorageProv, anotherTilesStorageProv],
        new client.Registry(),
        []
      );
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should call all the processing functions in a row and resolve without errors', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(processor.processTile(tile)).resolves.not.toThrow();

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
    });

    it('should call all the processing functions in a row and resolve without errors for multi stores processor', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      await expect(processorWithMultiStores.processTile(tile)).resolves.not.toThrow();

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(anotherTilesStorageProv.storeTiles).toHaveBeenCalled();
    });

    it('should throw error if getting map has failed', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      const getMapError = new Error('getting map error');
      getMap.mockRejectedValue(getMapError);

      await expect(processor.processTile(tile)).rejects.toThrow(getMapError);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).not.toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).not.toHaveBeenCalled();
    });

    it('should throw error if splitting map has failed', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      const splitMapError = new Error('splitting map error');
      splitMap.mockRejectedValue(splitMapError);

      await expect(processor.processTile(tile)).rejects.toThrow(splitMapError);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).not.toHaveBeenCalled();
    });

    it('should throw error if storing tiles had failed', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);
      const storeTileError = new Error('store tile error');
      storeTiles.mockRejectedValue(storeTileError);

      await expect(processor.processTile(tile)).rejects.toThrow(storeTileError);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
    });

    it('should throw error if storing tiles had failed on at least one of the multi storage processor', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);
      const storeTileError = new Error('store tile error');
      storeTiles.mockResolvedValueOnce(undefined).mockRejectedValue(storeTileError);

      await expect(processorWithMultiStores.processTile(tile)).rejects.toThrow(storeTileError);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTiles).toHaveBeenCalled();
      expect(anotherTilesStorageProv.storeTiles).toHaveBeenCalled();
    });
  });
});
