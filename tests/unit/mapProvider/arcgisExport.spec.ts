import { Readable } from 'stream';
import { AxiosError, AxiosInstance } from 'axios';
import jsLogger from '@map-colonies/js-logger';
import { streamToString } from '../../../src/common/utils';
import { ArcgisExportMapProvider } from '../../../src/retiler/mapProvider/arcgisExport';

jest.mock('axios');

describe('arcgisExport', () => {
  describe('#getMapStream', () => {
    let arcgisMap: ArcgisExportMapProvider;
    let mockedClient: jest.Mocked<AxiosInstance>;

    beforeEach(function () {
      mockedClient = { get: jest.fn() } as unknown as jest.Mocked<AxiosInstance>;
      arcgisMap = new ArcgisExportMapProvider(mockedClient, jsLogger({ enabled: false }), 'http://url.com');
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should resolve into a readable stream if the request has completed', async function () {
      const response = { data: Readable.from('test') };
      mockedClient.get.mockResolvedValue(response);

      const stream = await arcgisMap.getMapStream({ east: 180, west: -180, north: 90, south: -90 }, 256, 256);

      expect(stream).toBeInstanceOf(Readable);
      expect(await streamToString(stream)).toBe('test');
    });

    it('should throw an error if the request has failed', async function () {
      const error = new Error('some error') as AxiosError;
      error.toJSON = jest.fn();
      mockedClient.get.mockRejectedValue(error);

      const promise = arcgisMap.getMapStream({ east: 180, west: -180, north: 90, south: -90 }, 256, 256);

      await expect(promise).rejects.toThrow(error);
    });
  });
});
