import { S3Client } from '@aws-sdk/client-s3';
import jsLogger from '@map-colonies/js-logger';
import { S3TilesStorage } from '../../../src/retiler/tilesStorageProvider/s3';

jest.mock('@aws-sdk/client-s3');

describe('S3TilesStorage', () => {
  let storage: S3TilesStorage;
  let mockedS3Client: jest.Mocked<S3Client>;

  beforeEach(function () {
    mockedS3Client = new S3Client({}) as jest.Mocked<S3Client>;
    storage = new S3TilesStorage(mockedS3Client, jsLogger({ enabled: false }), 'test-bucket', { format: 'test/{z}/{x}/{y}.png', shouldFlipY: true });
  });

  afterEach(function () {
    jest.clearAllMocks();
  });

  describe('#storeTile', () => {
    it('should resolve without an error if client send resolved', async function () {
      const buffer = Buffer.from('test');
      mockedS3Client.send.mockResolvedValue(undefined as never);

      const promise = storage.storeTile({
        buffer,
        x: 1,
        y: 2,
        z: 3,
        metatile: 1,
      });

      await expect(promise).resolves.not.toThrow();
    });

    it('should throw an error if the request failed', async function () {
      const errorMessage = 'request failure error'
      const error = new Error(errorMessage);
      mockedS3Client.send.mockRejectedValue(error as never);

      const promise = storage.storeTile({
        buffer: Buffer.from('test'),
        x: 1,
        y: 2,
        z: 3,
        metatile: 1,
      });

      await expect(promise).rejects.toThrow(errorMessage);
    });
  });

  describe('#storeTiles', () => {
    it('should resolve without an error if client send resolved', async function () {
      mockedS3Client.send.mockResolvedValue(undefined as never);

      const tile = { x: 1, y: 2, z: 3, metatile: 1 };
      const buffer = Buffer.from('test');

      const promise = storage.storeTiles([
        { ...tile, buffer },
        { ...tile, buffer },
      ]);

      await expect(promise).resolves.not.toThrow();
    });

    it('should throw an error if one of the requests had failed', async function () {
      const errorMessage = 'request failure error';
      const error = new Error(errorMessage);
      mockedS3Client.send.mockRejectedValueOnce(error as never);

      const buffer = Buffer.from('test');
      const tile = { x: 1, y: 2, z: 3, metatile: 1 };

      const promise = storage.storeTiles([
        { ...tile, buffer },
        { ...tile, buffer },
      ]);

      await expect(promise).rejects.toThrow(errorMessage);
    });
  });
});
