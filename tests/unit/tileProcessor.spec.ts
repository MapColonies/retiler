import jsLogger from '@map-colonies/js-logger';
import { JobQueueProvider, MapProvider, MapSplitterProvider, TilesStorageProvider } from '../../src/retiler/interfaces';
import { TileProcessor } from '../../src/retiler/tileProcessor';

describe('TileProcessor', () => {
  let processor: TileProcessor;
  let jobQueueProv: JobQueueProvider;
  let mapProv: MapProvider;
  let mapSplitterProv: MapSplitterProvider;
  let tilesStorageProv: TilesStorageProvider;

  describe('#processRequest', () => {
    const get = jest.fn();
    const getMap = jest.fn();
    const splitMap = jest.fn();
    const storeTile = jest.fn();

    beforeEach(function () {
      jobQueueProv = {
        queueName: 'test',
        get,
        isEmpty: jest.fn(),
        complete: jest.fn(),
        fail: jest.fn(),
        startQueue: jest.fn(),
        stopQueue: jest.fn(),
      };

      mapProv = {
        getMap,
      };

      mapSplitterProv = {
        splitMap,
      };

      tilesStorageProv = {
        storeTile,
      };

      processor = new TileProcessor(jsLogger({ enabled: false }), jobQueueProv, mapProv, mapSplitterProv, tilesStorageProv);
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should report success if nothing had failed', async () => {
      const jobId = 'test';
      get.mockResolvedValue({ id: jobId, data: { x: 0, y: 0, z: 0, metatile: 8 } });
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

      const expectedReport = { successful: true, jobCompleted: true };

      await expect(processor.proccessRequest()).resolves.toMatchObject(expectedReport);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTile).toHaveBeenCalled();

      expect(jobQueueProv.complete).toHaveBeenCalledWith(jobId);
      expect(jobQueueProv.fail).not.toHaveBeenCalled();
    });

    it('should report success if job queue was empty and nothing to process', async () => {
      get.mockResolvedValue(null);

      const expectedReport = { successful: true, jobCompleted: false };

      const processPromise = processor.proccessRequest();

      await expect(processPromise).resolves.toMatchObject(expectedReport);

      expect(mapProv.getMap).not.toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).not.toHaveBeenCalled();
      expect(tilesStorageProv.storeTile).not.toHaveBeenCalled();

      expect(jobQueueProv.complete).not.toHaveBeenCalled();
      expect(jobQueueProv.fail).not.toHaveBeenCalled();
    });

    it('should report failure if getting map has failed', async () => {
      const jobId = 'test';
      get.mockResolvedValue({ id: jobId, data: { x: 0, y: 0, z: 0, metatile: 8 } });
      const getMapError = new Error('getting map error');
      getMap.mockRejectedValue(getMapError);

      const expectedReport = { successful: false, jobCompleted: false };

      await expect(processor.proccessRequest()).resolves.toMatchObject(expectedReport);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).not.toHaveBeenCalled();
      expect(tilesStorageProv.storeTile).not.toHaveBeenCalled();

      expect(jobQueueProv.complete).not.toHaveBeenCalled();
      expect(jobQueueProv.fail).toHaveBeenCalledWith(jobId, getMapError);
    });

    it('should report failure if splitting map has failed', async () => {
      const jobId = 'test';
      get.mockResolvedValue({ id: jobId, data: { x: 0, y: 0, z: 0, metatile: 8 } });
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      const splitMapError = new Error('splitting map error');
      splitMap.mockRejectedValue(splitMapError);

      const expectedReport = { successful: false, jobCompleted: false };

      await expect(processor.proccessRequest()).resolves.toMatchObject(expectedReport);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTile).not.toHaveBeenCalled();

      expect(jobQueueProv.complete).not.toHaveBeenCalled();
      expect(jobQueueProv.fail).toHaveBeenCalledWith(jobId, splitMapError);
    });

    it('should report failure if storing tiles had failed', async () => {
      const jobId = 'test';
      get.mockResolvedValue({ id: jobId, data: { x: 0, y: 0, z: 0, metatile: 8 } });
      const getMapResponse = Buffer.from('test');
      getMap.mockResolvedValue(getMapResponse);
      splitMap.mockResolvedValue([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);
      const storeTileError = new Error('store tile error');
      storeTile.mockRejectedValue(storeTileError);

      const expectedReport = { successful: false, jobCompleted: false };

      await expect(processor.proccessRequest()).resolves.toMatchObject(expectedReport);

      expect(mapProv.getMap).toHaveBeenCalled();
      expect(mapSplitterProv.splitMap).toHaveBeenCalled();
      expect(tilesStorageProv.storeTile).toHaveBeenCalled();

      expect(jobQueueProv.complete).not.toHaveBeenCalled();
      expect(jobQueueProv.fail).toHaveBeenCalledWith(jobId, storeTileError);
    });
  });
});
