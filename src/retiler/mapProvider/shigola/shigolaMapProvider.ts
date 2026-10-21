import { AxiosError, type AxiosInstance, AxiosResponse } from 'axios';
import { TILEGRID_WORLD_CRS84, tileToBoundingBox } from '@map-colonies/tile-calc';
import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { MAP_URL, SERVICES } from '../../../common/constants';
import { MapProvider } from '../../interfaces';
import { timerify } from '../../../common/util';
import { TileWithMetadata } from '../../types';

interface ShigolaRequest {
  bbox: [west: number, south: number, east: number, north: number];
}

@injectable()
export class ShigolaMapProvider implements MapProvider {
  public constructor(
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_URL) private readonly mapUrl: string
  ) {
    this.logger.info({ msg: 'initializing map provider', mapUrl, provider: 'shigola' });
  }

  public async getMap(tile: TileWithMetadata): Promise<Buffer> {
    const { parent, ...baseTile } = tile;
    const { west, south, east, north } = tileToBoundingBox(baseTile, TILEGRID_WORLD_CRS84, true);
    const body: ShigolaRequest = { bbox: [west, south, east, north] };

    try {
      this.logger.debug({ msg: 'sending bbox to shigola', tile: baseTile, parent, mapUrl: this.mapUrl, body });

      const [, duration] = await timerify<AxiosResponse, [string, ShigolaRequest]>(this.axiosClient.post.bind(this.axiosClient), this.mapUrl, body);

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
