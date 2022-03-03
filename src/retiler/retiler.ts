import { Logger } from '@map-colonies/js-logger';
import { Tile, TILEGRID_WORLD_CRS84, tileToBoundingBox } from '@map-colonies/tile-calc';
import { inject, injectable } from 'tsyringe';
import {
  DEFAULT_TILE_SIZE,
  JOBS_QUEUE_PROVIDER,
  MAP_PROVIDER,
  MAP_SPLITTER_PROVIDER,
  MAP_URL,
  QUEUE_NAME,
  REVERSE_Y,
  SERVICES,
  TILES_STORAGE_PROVIDER,
} from '../common/constants';
import { JobsQueueProvider, MapProvider, MapSplitterProvider, TilesStorageProvider } from './interfaces';
import { TilesLayout, tileToLayout as tileToPathLayout } from './tilesPath';

@injectable()
export class Retiler {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(QUEUE_NAME) private readonly queueName: string,
    @inject(MAP_URL) private readonly mapURL: string,
    @inject(REVERSE_Y) private readonly reverseY: string,
    @inject(JOBS_QUEUE_PROVIDER) private readonly jobsQueueProvider: JobsQueueProvider,
    @inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @inject(MAP_SPLITTER_PROVIDER) private readonly mapSplitter: MapSplitterProvider,
    @inject(TILES_STORAGE_PROVIDER) private readonly tilesStorageProvider: TilesStorageProvider
  ) {}

  public readonly proccessRequest = async (): Promise<boolean> => {
    // get a job from the queue (using pg-boss)
    const job = await this.jobsQueueProvider.get<Tile>();

    if (job === null) {
      this.logger.info(`queue '${this.queueName}' is empty`);
      return false;
    }

    const { data: tile, id, name } = job;

    try {
      const metatile = tile.metatile ?? 1;
      this.logger.debug(`job '${name}' with unique id '${id}' working on tile z:${tile.z}, x:${tile.x}, y:${tile.y}, metatile:${metatile}`);

      // convert tile to bounding box

      // TODO: add a provider that utilizes esri packages
      // https://esri.github.io/arcgis-rest-js/api/request/withOptions/
      // https://github.com/Esri/arcgis-rest-js/tree/master/packages/arcgis-rest-types
      // https://github.com/Esri/arcgis-rest-js/tree/master/packages/arcgis-rest-request
      const imageSize = metatile * DEFAULT_TILE_SIZE;
      const bbox = tileToBoundingBox(tile);
      // TODO: move request params relevant to arcgis-server to the relevant file
      const bboxRequestParam = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
      const imageSizeParam = `${imageSize},${imageSize}`;

      // TODO: maybe the endpoint should be a template endpoint that uses `projectName`
      const URL = `${this.mapURL}?bbox=${bboxRequestParam}&bboxSR=&layers=&layerDefs=&size=${imageSizeParam}&imageSR=&historicMoment=&format=png&transparent=true&dpi=&time=&layerTimeOptions=&dynamicLayers=&gdbVersion=&mapScale=&rotation=&datumTransformations=&layerParameterValues=&mapRangeValues=&layerRangeValues=&f=image`;

      // fetch a web map from the url and create a readable map stream (using https)
      this.logger.debug(`job '${name}' with unique id '${id}' invoking GET request to '${URL}'`);
      const mapStream = await this.mapProvider.getMapStream(URL);

      // prepare tile splitting pipeline (using sharp)

      // returns a pipeline to pipe a stream to and promises that will resolve when the pipeline completes all tile splitting
      const { promises, tiles, pipeline } = this.mapSplitter.generateSplitPipeline(tile);

      // if using a sync flow use the code bellow
      // const { data: syncData } = await this.mapProvider.getMap(URL);
      // writeFileSync('./output/fssyncimage.png', syncData);

      // pipe the map stream to tile splitting pipeline
      this.logger.debug(`job '${name}' with unique id '${id}' splitting map to ${metatile} by ${metatile} tiles`);
      mapStream.pipe(pipeline);

      // Promise.all keeps the order of the passed Promises, so buffers and tiles vars will have the same order
      const buffers = await Promise.all(promises);

      const tilesPromises: Promise<void>[] = tiles.map(async (tile, i) => {
        // transform tiles to paths layouts to store on the provided storage
        if (this.reverseY) {
          // we currently assume that the tile grid used is of WORLD CRS84
          // eslint-disable-next-line @typescript-eslint/no-magic-numbers
          tile.y = TILEGRID_WORLD_CRS84.numberOfMinLevelTilesY * 2 ** tile.z - tile.y - 1;
        }

        const tilePathLayout = tileToPathLayout(tile, TilesLayout.ZXY, `/${this.queueName}`, undefined, 'png');

        // store tiles (with @aws-sdk/clients-s3)
        return this.tilesStorageProvider.set(tilePathLayout, buffers[i]);
      });

      this.logger.debug(`job '${name}' with unique id '${id}' storing tiles in storage`);
      await Promise.all(tilesPromises); // Promise.all keeps the order of the passed Promises

      // update the queue that job completed
      await this.jobsQueueProvider.complete(id);
      this.logger.debug(`job '${name}' with unique id '${id}' completed successfully`);
      return true;
    } catch (err: unknown) {
      this.logger.error(err as Error);
      await this.jobsQueueProvider.fail(id);
      return false;
    }
  };
}
