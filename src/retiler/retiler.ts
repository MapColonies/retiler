import { Readable } from 'stream';
import { Logger } from '@map-colonies/js-logger';
import { Tile, TILEGRID_WORLD_CRS84, tileToBoundingBox } from '@map-colonies/tile-calc';
import { inject, injectable } from 'tsyringe';
import {
  DEFAULT_TILE_SIZE,
  JOB_QUEUE_PROVIDER,
  MAP_PROVIDER,
  MAP_SPLITTER_PROVIDER,
  MAP_URL,
  QUEUE_NAME,
  SERVICES,
  TILES_STORAGE_PROVIDER,
  TILE_PATH_LAYOUT,
} from '../common/constants';
import { JobQueueProvider, MapProvider, MapSplitterProvider, TilesStorageProvider } from './interfaces';
import { Job } from './jobQueueProvider/interfaces';
import { TilePathLayout, tileToPathLayout } from './tilesPath';
import { TileWithBuffer } from './types';

const SCALE_FACTOR = 2;

@injectable()
export class Retiler {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(QUEUE_NAME) private readonly queueName: string,
    @inject(TILE_PATH_LAYOUT) private readonly tilePathLayout: TilePathLayout,
    @inject(JOB_QUEUE_PROVIDER) private readonly jobsQueueProvider: JobQueueProvider,
    @inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @inject(MAP_SPLITTER_PROVIDER) private readonly mapSplitter: MapSplitterProvider,
    @inject(TILES_STORAGE_PROVIDER) private readonly tilesStorageProvider: TilesStorageProvider
  ) {}

  public readonly proccessRequest = async (): Promise<boolean> => {
    let startTime: number, endTime: number;
    const startTotalTime = performance.now();

    // get a job from the queue
    startTime = performance.now();
    const job = await this.getJob();

    if (job === false) {
      this.logger.info(`queue '${this.queueName}' is empty`);
      return false;
    }

    const { data, id, name } = job;
    const tile: Required<Tile> = { metatile: 1, ...data };

    const logJobMessage = `job '${name}' with unique id '${id}'`;

    endTime = performance.now();
    this.logger.debug(`${logJobMessage} was fetched from queue in ${Math.round(endTime - startTime)}ms`);

    try {
      this.logger.debug(`${logJobMessage} working on tile (z,x,y,metatile):(${tile.z},${tile.x},${tile.y},${tile.metatile}`);

      const mapStream = await this.mapProvider.getMapStream(
        tileToBoundingBox(tile),
        tile.metatile * DEFAULT_TILE_SIZE,
        tile.metatile * DEFAULT_TILE_SIZE
      );

      this.logger.debug(`${logJobMessage} splitting map to ${tile.metatile}x${tile.metatile} tiles`);
      const tiles = await this.mapSplitter.splitMap(tile, mapStream);

      this.logger.debug(`${logJobMessage} storing tiles in storage`);
      startTime = performance.now();

      await this.storeTiles(tiles);

      endTime = performance.now();
      this.logger.debug(`${logJobMessage} stored tiles successfully in ${Math.round(endTime - startTime)}ms`);

      // update the queue that the job completed successfully
      await this.jobsQueueProvider.complete(id);

      const endTotalTime = performance.now();
      this.logger.debug(
        `${logJobMessage} of tile (z,x,y,metatile):(${tile.z},${tile.x},${tile.y},${tile.metatile}) completed successfully in ${Math.round(
          endTotalTime - startTotalTime
        )}ms`
      );
      return true;
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(error);
      await this.jobsQueueProvider.fail(id, error);
      return false;
    }
  };

  private async getJob(): Promise<Job<Tile> | false> {
    const job = await this.jobsQueueProvider.get<Tile>();

    if (job === null) {
      return false;
    }

    return job;
  }

  private async storeTiles(tiles: TileWithBuffer[]): Promise<void> {
    const tilesPromises: Promise<void>[] = tiles.map(async (tile) => {
      if (
        tile.x >= (TILEGRID_WORLD_CRS84.numberOfMinLevelTilesX / (tile.metatile ?? 1)) * SCALE_FACTOR ** tile.z ||
        tile.y >= (TILEGRID_WORLD_CRS84.numberOfMinLevelTilesY / (tile.metatile ?? 1)) * SCALE_FACTOR ** tile.z
      ) {
        return;
      }

      if (this.tilePathLayout.reverseY) {
        // transform tiles to paths layouts to store on the provided storage
        // we currently assume that the tile grid used is WORLD CRS84
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        tile.y = (TILEGRID_WORLD_CRS84.numberOfMinLevelTilesY / (tile.metatile ?? 1)) * SCALE_FACTOR ** tile.z - tile.y - 1;
      }
      // store tiles
      return this.tilesStorageProvider.storeTile(tile);
    });

    await Promise.all(tilesPromises); // Promise.all keeps the order of the passed Promises
  }
}
