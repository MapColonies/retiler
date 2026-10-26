import { AxiosError, type AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { TILEGRID_WORLD_CRS84, tileToBoundingBox } from '@map-colonies/tile-calc';
import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { trace } from '@opentelemetry/api';
import { type ConfigType } from '../../../common/config';
import { BOUNDING_BOX_ORDER, MAP_URL, SERVICES } from '../../../common/constants';
import { MapProvider } from '../../interfaces';
import { timerify } from '../../../common/util';
import { jobAttributes } from '../../../common/tracing/job';
import { TileWithMetadata } from '../../types';
import { ShigolaRequest, ShigolaResponse } from './interfaces';

@injectable()
export class ShigolaMapProvider implements MapProvider {
  private readonly requestConfig: AxiosRequestConfig;
  private readonly targets: { map: string }[];

  public constructor(
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_URL) private readonly mapUrl: string,
    @inject(SERVICES.CONFIG) config: ConfigType
  ) {
    const mapToken = config.get('app.map.token');
    this.targets = (config.get('app.map.shigolaTargets') as string[]).map((map) => ({ map }));
    this.requestConfig = { headers: mapToken !== undefined ? { authorization: `Bearer ${mapToken}` } : undefined };
    this.logger.info({ msg: 'initializing map provider', mapUrl, provider: 'shigola', targets: this.targets, hasToken: mapToken !== undefined });
  }

  public async getMap(tile: TileWithMetadata): Promise<Buffer> {
    const { parent, ...baseTile } = tile;
    const boundingBox = tileToBoundingBox(baseTile, TILEGRID_WORLD_CRS84, true);
    const body: ShigolaRequest = {
      bounds: BOUNDING_BOX_ORDER.map((key) => boundingBox[key]),
      zoomRange: { min: tile.z, max: tile.z },
      targets: this.targets,
    };

    try {
      this.logger.debug({ msg: 'sending bbox to shigola', tile: baseTile, parent, mapUrl: this.mapUrl, body });

      const [response, duration] = await timerify<AxiosResponse<ShigolaResponse>, [string, ShigolaRequest, AxiosRequestConfig]>(
        this.axiosClient.post.bind(this.axiosClient),
        this.mapUrl,
        body,
        this.requestConfig
      );

      trace.getActiveSpan()?.setAttributes({
        [jobAttributes.MAP_RESPONSE_STATUS]: response.status,
        [jobAttributes.MAP_RESPONSE_BODY]: JSON.stringify(response.data),
      });
      this.logger.debug({
        msg: 'finished sending bbox to shigola',
        tile: baseTile,
        parent,
        duration,
        mapUrl: this.mapUrl,
        status: response.status,
        response: response.data,
      });

      const { failed, error } = response.data;
      if (failed > 0 || (error ?? '') !== '') {
        throw new Error(`shigola failed processing the request, failed: ${failed}, error: ${error ?? ''}`);
      }

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
