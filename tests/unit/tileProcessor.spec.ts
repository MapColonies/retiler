import jsLogger from '@map-colonies/js-logger';
import { MapProvider, MapSplitterProvider, TilesStorageProvider } from '../../src/retiler/interfaces';
import { TileProcessor } from '../../src/retiler/tileProcessor';

describe('TileProcessor', () => {
  let processor: TileProcessor;
  let mapProv: MapProvider;
  let mapSplitterProv: MapSplitterProvider;
  let tilesStorageProv: TilesStorageProvider;

  describe('#processTile', () => {
    const getMap = jest.fn();
    const splitMap = jest.fn();
    const storeTile = jest.fn();

    beforeEach(function () {
      mapProv = {
        getMap,
      };

      mapSplitterProv = {
        splitMap,
      };

      tilesStorageProv = {
        storeTile,
      };

      processor = new TileProcessor(jsLogger({ enabled: false }), mapProv, mapSplitterProv, tilesStorageProv);
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should resolve without errors if nothing had failed', async () => {
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
      expect(tilesStorageProv.storeTile).toHaveBeenCalled();
    });

    it('should throw error if getting map has failed', async () => {
      const tile = { x: 0, y: 0, z: 0, metatile: 8 };
      const getMapError = new Error('getting map error');
      getMap.mockRejectedValue(getMapError);

      await expect(processor.processTile(tile)).rejects.toThrow(getMapError);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).not.toHaveBeenCalled();
      expect(tilesStorageProv.storeTile).not.toHaveBeenCalled();
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
      expect(tilesStorageProv.storeTile).not.toHaveBeenCalled();
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
      storeTile.mockRejectedValue(storeTileError);

      await expect(processor.processTile(tile)).rejects.toThrow(storeTileError);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTile).toHaveBeenCalled();
    });
  });
});
