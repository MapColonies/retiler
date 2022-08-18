import { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { tileToBoundingBox } from '@map-colonies/tile-calc';
import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { MAP_FORMAT, MAP_PROVIDER_CONFIG, MAP_URL, SERVICES, TILE_SIZE } from '../../../common/constants';
import { MapProvider } from '../../interfaces';
import { timerify } from '../../../common/util';
import { TileWithMetadata } from '../../types';
import { BASE_REQUEST_PARAMS, getVersionDepParams, WmsConfig, WmsRequestParams } from './requestParams';

@injectable()
export class WmsMapProvider implements MapProvider {
  public constructor(
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_URL) private readonly mapUrl: string,
    @inject(MAP_FORMAT) private readonly mapFormat: string,
    @inject(MAP_PROVIDER_CONFIG) private readonly wmsConfig: WmsConfig
  ) {
    this.logger.info({ msg: 'initializing map provider', mapUrl, mapFormat, provider: 'wms', ...wmsConfig });
  }

  public async getMap(tile: TileWithMetadata): Promise<Buffer> {
    const { parent, ...baseTile } = tile;

    const bbox = tileToBoundingBox(baseTile);
    const mapSizePerAxis = tile.metatile * TILE_SIZE;

    const requestParams: WmsRequestParams = {
      ...BASE_REQUEST_PARAMS,
      ...getVersionDepParams(this.wmsConfig.version, bbox),
      ...this.wmsConfig,
      format: this.mapFormat,
      width: mapSizePerAxis,
      height: mapSizePerAxis,
    };

    try {
      const requestConfig: AxiosRequestConfig<Buffer> = { responseType: 'arraybuffer', params: requestParams };

      this.logger.debug({ msg: 'fetching map from provider', tile: baseTile, parent: tile.parent, mapUrl: this.mapUrl, ...requestConfig });

      const [response, duration] = await timerify<AxiosResponse<Buffer>, [string, AxiosRequestConfig]>(
        this.axiosClient.get.bind(this.axiosClient),
        this.mapUrl,
        requestConfig
      );

      if (response.headers['content-type'].includes('xml')) {
        throw new Error('The response returned from the service was in xml format');
      }

      this.logger.debug({ msg: 'finished fetching map from provider', tile: baseTile, duration, parent: tile.parent, mapUrl: this.mapUrl });

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<Buffer>;
      this.logger.error({
        msg: 'an error occurred while fetching map from provider',
        err: axiosError,
        tile: baseTile,
        parent: tile.parent,
        mapUrl: this.mapUrl,
      });
      throw axiosError;
    }
  }
}
