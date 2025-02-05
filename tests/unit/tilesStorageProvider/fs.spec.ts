import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import jsLogger from '@map-colonies/js-logger';
import { FsTilesStorage } from '../../../src/retiler/tilesStorageProvider/fs';

jest.mock('fs');
jest.mock('fs/promises');
jest.mock('@map-colonies/read-pkg', () => ({
  readPackageJsonSync: jest.fn().mockImplementation(() => {
    return { name: 'retiler_test' };
  }),
}));

describe('FsTilesStorage', () => {
  let storage: FsTilesStorage;

  beforeEach(function () {
    storage = new FsTilesStorage(jsLogger({ enabled: false }), 'test-path', { format: 'test/{z}/{x}/{y}.png', shouldFlipY: true });
  });

  afterEach(function () {
    jest.clearAllMocks();
  });

  describe('#storeTile', () => {
    it('should resolve without an error if existsSync returns true and writeFile resolved', async function () {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fsPromises.writeFile as jest.Mock).mockResolvedValueOnce(undefined);
      const buffer = Buffer.from('test');

      const promise = storage.storeTile({
        buffer,
        x: 1,
        y: 2,
        z: 3,
        metatile: 1,
      });

      await expect(promise).resolves.not.toThrow();
      expect(fs.existsSync).toHaveBeenCalledTimes(1);
      expect(fsPromises.mkdir).toHaveBeenCalledTimes(0);
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
      expect(fsPromises.writeFile).toHaveBeenCalledWith('test-path/test/3/1/5.png', buffer);
    });

    it('should resolve without an error if existsSync returns false and writeFile resolved', async function () {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const buffer = Buffer.from('test');

      const promise = storage.storeTile({
        buffer,
        x: 1,
        y: 2,
        z: 3,
        metatile: 1,
      });

      await expect(promise).resolves.not.toThrow();
      expect(fs.existsSync).toHaveBeenCalledTimes(1);
      expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
      expect(fsPromises.writeFile).toHaveBeenCalledWith('test-path/test/3/1/5.png', buffer);
    });

    it('should throw an error if the request failed', async function () {
      const createDirectorySpy = jest.spyOn(FsTilesStorage.prototype, 'createDirectoryIfNotExists');
      const errorMessage = 'request failure error';
      const error = new Error(errorMessage);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fsPromises.writeFile as jest.Mock).mockRejectedValue(error);

      const promise = storage.storeTile({
        buffer: Buffer.from('test'),
        x: 1,
        y: 2,
        z: 3,
        metatile: 1,
      });

      await expect(promise).rejects.toThrow(errorMessage);
      expect(createDirectorySpy).toHaveBeenCalledTimes(1);
      expect(fsPromises.mkdir).toHaveBeenCalledTimes(0);
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('#storeTiles', () => {
    it('should resolve without an error if fs writeFile resolves', async function () {
      (fs.existsSync as jest.Mock).mockReturnValueOnce(false).mockResolvedValue(true);
      (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const tile1 = { x: 1, y: 2, z: 3, metatile: 1 };
      const tile2 = { x: 2, y: 2, z: 3, metatile: 1 };
      const buffer = Buffer.from('test');

      const promise = storage.storeTiles([
        { ...tile1, buffer },
        { ...tile2, buffer },
      ]);

      await expect(promise).resolves.not.toThrow();
      expect(fs.existsSync).toHaveBeenCalledTimes(2);
      expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(2);
      expect(fsPromises.writeFile).toHaveBeenNthCalledWith(1, 'test-path/test/3/2/5.png', buffer);
      expect(fsPromises.writeFile).toHaveBeenNthCalledWith(2, 'test-path/test/3/1/5.png', buffer);
    });

    it('should throw an error if one of the requests had failed', async function () {
      const createDirectorySpy = jest.spyOn(FsTilesStorage.prototype, 'createDirectoryIfNotExists');
      const errorMessage = 'request failure error';
      const error = new Error(errorMessage);
      (fs.existsSync as jest.Mock).mockReturnValueOnce(false).mockResolvedValue(true);
      (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.writeFile as jest.Mock).mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);

      const buffer = Buffer.from('test');
      const tile = { x: 1, y: 2, z: 3, metatile: 1 };

      const promise = storage.storeTiles([
        { ...tile, buffer },
        { ...tile, buffer },
      ]);

      await expect(promise).rejects.toThrow(errorMessage);
      expect(createDirectorySpy).toHaveBeenCalledTimes(2);
      expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(2);
    });
  });
});
