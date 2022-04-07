import { S3Client } from '@aws-sdk/client-s3';
import { S3Error } from '../../../src/common/errors';
import { S3TilesStorage } from '../../../src/retiler/tilesStorageProvider/s3';

jest.mock('@aws-sdk/client-s3');

describe('S3TilesStorage', () => {
  describe('#storeTile', () => {
    let storage: S3TilesStorage;
    let mockedS3Client: jest.Mocked<S3Client>;

    beforeEach(function () {
      mockedS3Client = new S3Client({}) as jest.Mocked<S3Client>;
      storage = new S3TilesStorage(mockedS3Client, 'test-bucket', { format: 'test/{z}/{x}/{y}.png', shouldFlipY: true });
    });
    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should resolve without an error if client send resolved', async function () {
      const buffer = Buffer.from('test');
      mockedS3Client.send.mockResolvedValue(undefined as never);

      const promise = storage.storeTile({
        buffer,
        x: 1,
        y: 2,
        z: 3,
      });

      await expect(promise).resolves.not.toThrow();
    });

    it('should throw an S3Error if the request failed', async function () {
      const error = new Error('request failure error');
      mockedS3Client.send.mockRejectedValue(error as never);

      const promise = storage.storeTile({
        buffer: Buffer.from('test'),
        x: 1,
        y: 2,
        z: 3,
      });

      await expect(promise).rejects.toThrow(S3Error);
    });
  });

  describe('#storeTiles', () => {
    let storage: S3TilesStorage;
    let mockedS3Client: jest.Mocked<S3Client>;

    beforeEach(function () {
      mockedS3Client = new S3Client({}) as jest.Mocked<S3Client>;
      storage = new S3TilesStorage(mockedS3Client, 'test-bucket', { format: 'test/{z}/{x}/{y}.png', shouldFlipY: true });
    });
    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should resolve without an error if client send resolved', async function () {
      const buffer = Buffer.from('test');
      mockedS3Client.send.mockResolvedValue(undefined as never);

      const promise = storage.storeTiles([
        {
          buffer,
          x: 1,
          y: 2,
          z: 3,
        },
        {
          buffer,
          x: 1,
          y: 2,
          z: 3,
        },
      ]);

      await expect(promise).resolves.not.toThrow();
    });

    it('should throw an S3Error if one of the requests had failed', async function () {
      const error = new Error('request failure error');
      mockedS3Client.send.mockRejectedValueOnce(error as never);
      const buffer = Buffer.from('test');

      const promise = storage.storeTiles([{
        buffer,
        x: 1,
        y: 2,
        z: 3,
      }, {
        buffer,
        x: 1,
        y: 2,
        z: 3,
      }]);

      await expect(promise).rejects.toThrow(S3Error);
    });
  });
});
