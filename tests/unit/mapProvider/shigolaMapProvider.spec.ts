import type { AxiosError, AxiosInstance } from 'axios';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import type { ConfigType } from '../../../src/common/config';
import { ShigolaMapProvider } from '../../../src/retiler/mapProvider/shigola/shigolaMapProvider';

let logger: Logger;

const configWithToken = (token?: string): ConfigType => ({ get: jest.fn().mockReturnValue(token) }) as unknown as ConfigType;

beforeAll(async () => {
  logger = await jsLogger({ enabled: false });
});

describe('ShigolaMapProvider', () => {
  describe('#getMap', () => {
    let shigolaProv: ShigolaMapProvider;
    let post: jest.Mock;

    beforeEach(function () {
      post = jest.fn();
      shigolaProv = new ShigolaMapProvider({ post } as unknown as AxiosInstance, logger, 'http://shigola/route', configWithToken());
    });

    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should post the tile bbox to the map url and resolve into an empty buffer', async function () {
      post.mockResolvedValue({ data: {} });

      const buffer = await shigolaProv.getMap({ z: 0, x: 0, y: 0, metatile: 8, parent: 'parent' });

      expect(buffer).toHaveLength(0);
      expect(post).toHaveBeenCalledWith('http://shigola/route', { bbox: [-180, -90, 180, 90] }, { headers: undefined });
    });

    it('should send the token as a bearer authorization header when configured', async function () {
      post.mockResolvedValue({ data: {} });
      const shigolaProvWithToken = new ShigolaMapProvider(
        { post } as unknown as AxiosInstance,
        logger,
        'http://shigola/route',
        configWithToken('secret')
      );

      await shigolaProvWithToken.getMap({ z: 0, x: 0, y: 0, metatile: 8 });

      expect(post).toHaveBeenCalledWith('http://shigola/route', { bbox: [-180, -90, 180, 90] }, { headers: { authorization: 'Bearer secret' } });
    });

    it('should throw an error if the request has failed', async function () {
      const error = new Error('some error') as AxiosError;
      post.mockRejectedValue(error);

      await expect(shigolaProv.getMap({ z: 0, x: 0, y: 0, metatile: 8 })).rejects.toThrow(error);
    });
  });
});
