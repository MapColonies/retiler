import { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { tileToBoundingBox } from '@map-colonies/tile-calc';
import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { MAP_FORMAT, MAP_URL, SERVICES, TILE_SIZE } from '../../common/constants';
import { MapProvider } from '../interfaces';
import { timerify } from '../../common/util';
import { TileWithMetadata } from '../types';
import { ARCGIS_MAP_PARAMS } from './constants';

@injectable()
export class ArcgisExportMapProvider implements MapProvider {
  public constructor(
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_URL) private readonly mapUrl: string,
    @inject(MAP_FORMAT) private readonly mapFormat: string
  ) {}

  public async getMap(tile: TileWithMetadata): Promise<Buffer> {
    const { parent, ...baseTile } = tile;
    this.logger.debug({ msg: `fetching map from ${this.mapUrl}`, tile: baseTile, parent: tile.parent });

    const bbox = tileToBoundingBox(baseTile);
    const mapSizePerAxis = tile.metatile * TILE_SIZE;

    const requestParams = {
      ...ARCGIS_MAP_PARAMS,
      format: this.mapFormat,
      bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      size: `${mapSizePerAxis},${mapSizePerAxis}`,
    };

    try {
      const [response, duration] = await timerify<AxiosResponse<Buffer>, [string, AxiosRequestConfig]>(
        this.axiosClient.get.bind(this.axiosClient),
        this.mapUrl,
        { responseType: 'arraybuffer', params: requestParams }
      );

      this.logger.debug({ msg: 'finished fetching map', tile: baseTile, duration, parent: tile.parent });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<Buffer>;
      throw axiosError;
    }
  }
}
