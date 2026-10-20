import { AxiosError, type AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { TILEGRID_WORLD_CRS84, tileToBoundingBox } from '@map-colonies/tile-calc';
import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { type VectorRetilerSchemaType } from '../../common/config';
import { CACHE_PURGER_CONFIG, SERVICES } from '../../common/constants';
import { timerify } from '../../common/util';
import type { CachePurger } from '../interfaces';
import type { TileWithMetadata } from '../types';

const PURGE_PATH = '/cache/purge';

export type CachePurgerConfig = NonNullable<VectorRetilerSchemaType['app']['cachePurger']>;

export interface PurgeRequest {
  bounds: [west: number, south: number, east: number, north: number];
  zoomRange: { min: number; max: number };
  targets: { map: string }[];
}

export interface PurgeResponse {
  purged: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

@injectable()
export class HttpCachePurger implements CachePurger {
  private readonly purgeUrl: string;
  private readonly mapName: string;
  private readonly requestConfig: AxiosRequestConfig;

  public constructor(
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(CACHE_PURGER_CONFIG) { url, map, token, timeoutMs }: CachePurgerConfig
  ) {
    this.purgeUrl = `${url.replace(/\/+$/, '')}${PURGE_PATH}`;
    this.mapName = map;
    this.requestConfig = { timeout: timeoutMs, headers: token !== undefined ? { authorization: `Bearer ${token}` } : undefined };
    this.logger.info({
      msg: 'initializing cache purger',
      purgeUrl: this.purgeUrl,
      mapName: this.mapName,
      timeoutMs,
      hasToken: token !== undefined,
    });
  }

  public async sendPurgeRequest(tile: TileWithMetadata): Promise<void> {
    const { parent, ...baseTile } = tile;
    const { west, south, east, north } = tileToBoundingBox(baseTile, TILEGRID_WORLD_CRS84, true);

    const body: PurgeRequest = {
      bounds: [west, south, east, north],
      zoomRange: { min: tile.z, max: tile.z },
      targets: [{ map: this.mapName }],
    };

    try {
      this.logger.debug({ msg: 'sending purge request', tile: baseTile, parent, purgeUrl: this.purgeUrl, body });

      const [response, duration] = await timerify<AxiosResponse<PurgeResponse>, [string, PurgeRequest, AxiosRequestConfig]>(
        this.axiosClient.post.bind(this.axiosClient),
        this.purgeUrl,
        body,
        this.requestConfig
      );

      this.logger.debug({ msg: 'finished purge request', tile: baseTile, parent, duration, purgeUrl: this.purgeUrl, result: response.data });
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error({
        msg: 'an error occurred while sending purge request',
        err: axiosError,
        tile: baseTile,
        parent,
        purgeUrl: this.purgeUrl,
        response: axiosError.response?.data,
      });
      throw axiosError;
    }
  }
}
