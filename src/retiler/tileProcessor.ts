import { Logger } from '@map-colonies/js-logger';
import { Tile, tileToBoundingBox } from '@map-colonies/tile-calc';
import { inject, injectable } from 'tsyringe';
import { TILE_SIZE, JOB_QUEUE_PROVIDER, MAP_PROVIDER, MAP_SPLITTER_PROVIDER, SERVICES, TILES_STORAGE_PROVIDER } from '../common/constants';
import { measurePromise, roundMs } from '../common/util';
import { JobQueueProvider, MapProvider, MapSplitterProvider, TilesStorageProvider } from './interfaces';

interface ProcessReport {
  successful: boolean;
  jobCompleted: boolean;
}

@injectable()
export class TileProcessor {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(JOB_QUEUE_PROVIDER) private readonly jobQueueProvider: JobQueueProvider,
    @inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @inject(MAP_SPLITTER_PROVIDER) private readonly mapSplitter: MapSplitterProvider,
    @inject(TILES_STORAGE_PROVIDER) private readonly tilesStorageProvider: TilesStorageProvider
  ) {}

  public async proccessRequest(): Promise<ProcessReport> {
    const startTime = performance.now();

    const getJobPromise = this.jobQueueProvider.get<Tile>();
    const [job, getJobDuration] = await measurePromise(getJobPromise);

    if (job == null) {
      this.logger.info(`nothing to process, queue ${this.jobQueueProvider.queueName} is empty`);
      return { successful: true, jobCompleted: false };
    }

    const tile = { ...job.data, metatile: job.data.metatile ?? 1 };
    const logMessagePrefix = `job ${job.name} id ${job.id}`;
    const tileDescription = `{ z: ${tile.z}, x: ${tile.x}, y: ${tile.y}, metatile: ${tile.metatile} }`;

    this.logger.debug(`${logMessagePrefix} was fetched from queue in ${roundMs(getJobDuration)}`);

    try {
      this.logger.debug(`${logMessagePrefix} processing tile ${tileDescription}`);

      const bbox = tileToBoundingBox(tile);
      const mapSizePerAxis = tile.metatile * TILE_SIZE;
      const getMapPromise = this.mapProvider.getMap(bbox, mapSizePerAxis, mapSizePerAxis);
      const [mapBuffer, getMapDuration] = await measurePromise(getMapPromise);

      this.logger.debug(`${logMessagePrefix} got map in ${roundMs(getMapDuration)}`);

      this.logger.debug(`${logMessagePrefix} splitting map into ${tile.metatile}x${tile.metatile} tiles`);

      const splitMapPromise = this.mapSplitter.splitMap(tile, mapBuffer);
      const [tiles, splitMapDuration] = await measurePromise(splitMapPromise);

      this.logger.debug(`${logMessagePrefix} splitted map in ${roundMs(splitMapDuration)}`);

      this.logger.debug(`${logMessagePrefix} storing tiles, ${tiles.length} tiles to be stored`);

      const storeTilesPromise = Promise.all(tiles.map(async (tile) => this.tilesStorageProvider.storeTile(tile)));
      const [, storeTilesDuration] = await measurePromise(storeTilesPromise);

      this.logger.debug(`${logMessagePrefix} stored tiles in ${roundMs(storeTilesDuration)}`);

      await this.jobQueueProvider.complete(job.id);

      const endTime = performance.now();
      this.logger.info(`${logMessagePrefix} processing of tile ${tileDescription} completed successfully in ${roundMs(endTime - startTime)}`);

      return { successful: true, jobCompleted: true };
    } catch (err) {
      const error = err as Error;
      this.logger.error(`${logMessagePrefix} ${tileDescription} ${error.message}`);

      await this.jobQueueProvider.fail(job.id, error);

      return { successful: false, jobCompleted: false };
    }
  }
}
