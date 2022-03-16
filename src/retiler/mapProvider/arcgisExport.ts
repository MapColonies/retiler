import { Readable } from 'stream';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { BoundingBox } from '@map-colonies/tile-calc';
import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { MAP_URL, SERVICES } from '../../common/constants';
import { MapProvider } from '../interfaces';

const constParams = {
  bboxSR: '',
  layers: '',
  layerDefs: '',
  imageSR: '',
  historicMoment: '',
  format: 'png',
  transparent: true,
  dpi: '',
  time: '',
  layerTimeOptions: '',
  dynamicLayers: '',
  gdbVersion: '',
  mapScale: '',
  rotation: '',
  datumTransformations: '',
  layerParameterValues: '',
  mapRangeValues: '',
  layerRangeValues: '',
  f: 'image',
};

@injectable()
export class ArcgisExportMapProvider implements MapProvider {
  private readonly axiosClient: AxiosInstance;

  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(MAP_URL) private readonly mapURL: string) {
    this.axiosClient = axios.create({ timeout: 30000 });
  }

  public async getMapStream(bbox: BoundingBox, mapWidth: number, mapHeight: number): Promise<Readable> {
    const requestParams = {
      ...constParams,
      bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      size: `${mapWidth},${mapHeight}`,
    };

    try {
      return (await this.axiosClient.get<Readable>(this.mapURL, { responseType: 'stream', params: requestParams })).data;
    } catch (error) {
      const axiosError = error as AxiosError<Readable>;
      this.logger.debug(axiosError.toJSON());
      throw axiosError;
    }
  }
}
