import client from 'prom-client';
import { Logger } from '@map-colonies/js-logger';
import { IDetilerClient } from '@map-colonies/detiler-client';
import { inject, injectable } from 'tsyringe';
import { AxiosInstance } from 'axios';
import { IConfig } from '../common/interfaces';
import { IProjectConfig } from '../common/interfaces';
import { fetchTimestampValue, timestampToUnix } from '../common/util';
import {
  MAP_PROVIDER,
  MAP_SPLITTER_PROVIDER,
  METRICS_BUCKETS,
  METRICS_REGISTRY,
  MILLISECONDS_IN_SECOND,
  SERVICES,
  TILES_STORAGE_PROVIDERS,
} from '../common/constants';
import { MapProvider, MapSplitterProvider, TilesStorageProvider } from './interfaces';
import { TileWithMetadata } from './types';

@injectable()
export class TileProcessor {
  private readonly project: IProjectConfig;
  private readonly forceProcess: boolean;
  private readonly detilerProceedOnFailure: boolean;

  private readonly tilesCounter?: client.Counter<'status' | 'z'>;
  private readonly tilesDurationHistogram?: client.Histogram<'z' | 'kind'>;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @inject(MAP_SPLITTER_PROVIDER) private readonly mapSplitter: MapSplitterProvider,
    @inject(TILES_STORAGE_PROVIDERS) private readonly tilesStorageProviders: TilesStorageProvider[],
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.CONFIG) private readonly config: IConfig,
    @inject(SERVICES.DETILER) private readonly detiler?: IDetilerClient,
    @inject(METRICS_REGISTRY) registry?: client.Registry,
    @inject(METRICS_BUCKETS) metricsBuckets?: number[]
  ) {
    this.project = this.config.get<IProjectConfig>('app.project');
    this.forceProcess = this.config.get<boolean>('app.forceProcess');
    this.detilerProceedOnFailure = this.config.get<boolean>('detiler.proceedOnFailure');

    if (registry !== undefined) {
      this.tilesDurationHistogram = new client.Histogram({
        name: 'retiler_action_duration_seconds',
        help: 'Retiler action duration by kind, one of fetch, slice or store.',
        buckets: metricsBuckets,
        labelNames: ['kind', 'z'] as const,
        registers: [registry],
      });

      this.tilesCounter = new client.Counter({
        name: 'retiler_tiles_count',
        help: 'The total number of tiles processed',
        labelNames: ['status', 'z'] as const,
        registers: [registry],
      });
    }
  }

  public async processTile(tile: TileWithMetadata): Promise<void> {
    try {
      // set the tile's updatedAt timestamp to be just before getMap call
      const preRenderTimestamp = Math.floor(Date.now() / MILLISECONDS_IN_SECOND);

      // check if possibly the tile processing can be skipped according to detiler
      const shouldSkip = await this.preProcess(tile, preRenderTimestamp);
      if (shouldSkip) {
        this.tilesCounter?.inc({ status: 'skipped', z: tile.z });
        return;
      }

      const fetchTimerEnd = this.tilesDurationHistogram?.startTimer({ kind: 'fetch', z: tile.z });
      const mapBuffer = await this.mapProvider.getMap(tile);
      if (fetchTimerEnd) {
        fetchTimerEnd();
      }

      const splitTimerEnd = this.tilesDurationHistogram?.startTimer({ kind: 'split' });
      const tiles = await this.mapSplitter.splitMap({ ...tile, buffer: mapBuffer });
      if (splitTimerEnd) {
        splitTimerEnd();
      }

      if (tiles.length > 0) {
        this.logger.debug({ msg: 'storing tiles', count: tiles.length, providersCount: this.tilesStorageProviders.length });

        const storeTimerEnd = this.tilesDurationHistogram?.startTimer({ kind: 'store' });
        await Promise.all(this.tilesStorageProviders.map(async (tilesStorageProv) => tilesStorageProv.storeTiles(tiles)));
        if (storeTimerEnd) {
          storeTimerEnd();
        }
      }

      // update the tile's details according to the current processing
      await this.postProcess(tile, preRenderTimestamp);

      this.tilesCounter?.inc({ status: 'completed', z: tile.z });
    } catch (error) {
      this.tilesCounter?.inc({ status: 'failed', z: tile.z });
      throw error;
    }
  }

  private async preProcess(tile: TileWithMetadata, timestamp: number): Promise<boolean> {
    const isForced = this.forceProcess || tile.force === true;

    if (this.detiler === undefined || isForced) {
      return false;
    }

    const detilerGetTimerEnd = this.tilesDurationHistogram?.startTimer({ kind: 'detilerGet' });

    try {
      // attempt to get latest tile details
      const tileDetails = await this.detiler.getTileDetails({ kit: this.project.name, z: tile.z, x: tile.x, y: tile.y });

      if (tileDetails !== null) {
        // get the project last update time
        const projectState = await this.axiosClient.get<Buffer>(this.project.stateUrl, { responseType: 'arraybuffer' });
        const projectStateContent = projectState.data.toString();
        const projectTimestamp = timestampToUnix(fetchTimestampValue(projectStateContent));

        this.logger.info({ msg: 'determining if should skip tile processing', tile, tileDetails, sourceUpdatedAt: projectTimestamp });

        // skip processing if tile update time is later than project update time
        if (tileDetails.renderedAt >= projectTimestamp) {
          await this.detiler.setTileDetails(
            { kit: this.project.name, z: tile.z, x: tile.x, y: tile.y },
            { hasSkipped: true, state: tile.state, timestamp }
          );
          this.logger.info({ msg: 'skipping tile processing', tile, tileDetails, sourceUpdatedAt: projectTimestamp });
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error({ msg: 'an error occurred while pre processing, tile will be processed', error });
      return false;
    } finally {
      if (detilerGetTimerEnd) {
        detilerGetTimerEnd();
      }
    }
  }

  private async postProcess(tile: TileWithMetadata, timestamp: number): Promise<void> {
    if (this.detiler === undefined) {
      return;
    }

    const detilerSetTimerEnd = this.tilesDurationHistogram?.startTimer({ kind: 'detilerSet' });

    try {
      await this.detiler.setTileDetails({ kit: this.project.name, z: tile.z, x: tile.x, y: tile.y }, { state: tile.state, timestamp });
    } catch (error) {
      this.logger.error({ msg: 'an error occurred while post processing, skipping details set', error });
      if (!this.detilerProceedOnFailure) {
        throw error;
      }
    } finally {
      if (detilerSetTimerEnd) {
        detilerSetTimerEnd();
      }
    }
  }
}
