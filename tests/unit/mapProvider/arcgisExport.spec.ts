import { AxiosError, AxiosInstance } from 'axios';
import jsLogger from '@map-colonies/js-logger';
import { ArcgisExportMapProvider } from '../../../src/retiler/mapProvider/arcgisExport';

jest.mock('axios');

describe('arcgisExport', () => {
  describe('#getMapBuffer', () => {
    let arcgisMap: ArcgisExportMapProvider;
    let mockedClient: jest.Mocked<AxiosInstance>;

    beforeEach(function () {
      mockedClient = { get: jest.fn() } as unknown as jest.Mocked<AxiosInstance>;
      arcgisMap = new ArcgisExportMapProvider(mockedClient, jsLogger({ enabled: false }), 'http://url.com');
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should resolve into a buffer if the request has completed', async function () {
      const response = { data: Buffer.from('test') };
      mockedClient.get.mockResolvedValue(response);

      const buffer = await arcgisMap.getMapBuffer({ east: 180, west: -180, north: 90, south: -90 }, 256, 256);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString()).toBe('test');
    });

    it('should throw an error if the request has failed', async function () {
      const error = new Error('some error') as AxiosError;
      error.toJSON = jest.fn();
      mockedClient.get.mockRejectedValue(error);

      const promise = arcgisMap.getMapBuffer({ east: 180, west: -180, north: 90, south: -90 }, 256, 256);

      await expect(promise).rejects.toThrow(error);
    });
  });
});
