import { Readable } from 'stream';
import { AxiosError, AxiosInstance } from 'axios';
import { Tile, tileToBoundingBox } from '@map-colonies/tile-calc';
import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { MAP_URL, SERVICES, TILE_SIZE } from '../../common/constants';
import { MapProvider } from '../interfaces';
import { ARCGIS_MAP_PARAMS } from './constants';

@injectable()
export class ArcgisExportMapProvider implements MapProvider {
  public constructor(
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_URL) private readonly mapUrl: string
  ) {}

  public async getMap(tile: Required<Tile>): Promise<Buffer> {
    this.logger.debug({ msg: `getting map from ${this.mapUrl}`, tile });

    const bbox = tileToBoundingBox(tile);
    const mapSizePerAxis = tile.metatile * TILE_SIZE;

    const requestParams = {
      ...ARCGIS_MAP_PARAMS,
      bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      size: `${mapSizePerAxis},${mapSizePerAxis}`,
    };

    try {
      const response = await this.axiosClient.get<Buffer>(this.mapUrl, { responseType: 'arraybuffer', params: requestParams });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<Readable>;
      this.logger.debug(axiosError.toJSON());
      throw axiosError;
    }
  }
}
