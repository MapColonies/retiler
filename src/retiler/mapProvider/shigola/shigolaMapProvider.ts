import { AxiosError, type AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { TILEGRID_WORLD_CRS84, tileToBoundingBox } from '@map-colonies/tile-calc';
import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { type ConfigType } from '../../../common/config';
import { MAP_URL, SERVICES } from '../../../common/constants';
import { MapProvider } from '../../interfaces';
import { timerify } from '../../../common/util';
import { TileWithMetadata } from '../../types';

interface ShigolaRequest {
  bounds: [west: number, south: number, east: number, north: number];
  zoomRange: { min: number; max: number };
  targets: { map: string }[];
}

@injectable()
export class ShigolaMapProvider implements MapProvider {
  private readonly requestConfig: AxiosRequestConfig;
  private readonly targetMap: string;

  public constructor(
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_URL) private readonly mapUrl: string,
    @inject(SERVICES.CONFIG) config: ConfigType
  ) {
    const mapToken = config.get('app.map.token');
    this.targetMap = config.get('app.map.targetMap') as string;
    this.requestConfig = { headers: mapToken !== undefined ? { authorization: `Bearer ${mapToken}` } : undefined };
    this.logger.info({ msg: 'initializing map provider', mapUrl, provider: 'shigola', targetMap: this.targetMap, hasToken: mapToken !== undefined });
  }

  public async getMap(tile: TileWithMetadata): Promise<Buffer> {
    const { parent, ...baseTile } = tile;
    const { west, south, east, north } = tileToBoundingBox(baseTile, TILEGRID_WORLD_CRS84, true);
    const body: ShigolaRequest = {
      bounds: [west, south, east, north],
      zoomRange: { min: tile.z, max: tile.z },
      targets: [{ map: this.targetMap }],
    };

    try {
      this.logger.debug({ msg: 'sending bbox to shigola', tile: baseTile, parent, mapUrl: this.mapUrl, body });

      const [, duration] = await timerify<AxiosResponse, [string, ShigolaRequest, AxiosRequestConfig]>(
        this.axiosClient.post.bind(this.axiosClient),
        this.mapUrl,
        body,
        this.requestConfig
      );

      this.logger.debug({ msg: 'finished sending bbox to shigola', tile: baseTile, parent, duration, mapUrl: this.mapUrl });
      return Buffer.alloc(0);
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error({
        msg: 'an error occurred while sending bbox to shigola',
        err: axiosError,
        tile: baseTile,
        parent,
        mapUrl: this.mapUrl,
      });
      throw axiosError;
    }
  }
}
