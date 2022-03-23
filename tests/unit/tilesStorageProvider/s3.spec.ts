import { S3Client } from '@aws-sdk/client-s3';
import { S3Error } from '../../../src/common/errors';
import { ShutdownHandler } from '../../../src/common/shutdownHandler';
import { TileLayout } from '../../../src/retiler/tilesPath';
import { S3TilesStorage } from '../../../src/retiler/tilesStorageProvider/s3';

jest.mock('@aws-sdk/client-s3');

const mockedClient = S3Client.prototype as jest.Mocked<S3Client>;

describe('S3TilesStorage', () => {
  describe('#storeTile', () => {
    let storage: S3TilesStorage;
    beforeEach(function () {
      storage = new S3TilesStorage(
        { addFunction: jest.fn() } as unknown as ShutdownHandler,
        {},
        { prefix: 'test', tileLayout: TileLayout.ZXY, reverseY: false },
        'test-bucket'
      );
    });
    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should resolve without an error if everything is ok', async function () {
      const buffer = Buffer.from('test');
      mockedClient.send.mockResolvedValue('' as never);

      const promise = storage.storeTile({
        buffer,
        x: 1,
        y: 2,
        z: 3,
      });

      await expect(promise).resolves.not.toThrow();
    });

    it('should throw an S3Error if the request failed', async function () {
      const error = new Error('test');
      mockedClient.send.mockRejectedValue(error as never);

      const promise = storage.storeTile({
        buffer: Buffer.from('test'),
        x: 1,
        y: 2,
        z: 3,
      });

      await expect(promise).rejects.toThrow(S3Error);
    });
  });
});
