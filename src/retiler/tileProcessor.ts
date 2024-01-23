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
      // check if possibly the tile processing can be skipped according to detiler
      const shouldSkip = await this.preProcess(tile);
      if (shouldSkip) {
        this.tilesCounter?.inc({ status: 'skipped', z: tile.z });
        return;
      }

      // set the tile's updatedAt timestamp to be just before getMap call
      const preRenderTimestamp = Math.floor(Date.now() / MILLISECONDS_IN_SECOND);

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

  private async preProcess(tile: TileWithMetadata): Promise<boolean> {
    const isForced = this.forceProcess || tile.force === true;

    if (this.detiler === undefined || isForced) {
      return false;
    }

    const detilerGetTimerEnd = this.tilesDurationHistogram?.startTimer({ kind: 'detilerGet' });

    // attempt to get latest tile details
    const details = await this.detiler.getTileDetails({ kit: this.project.name, z: tile.z, x: tile.x, y: tile.y });

    if (details !== null) {
      // get the project last update time
      const projectState = await this.axiosClient.get<Buffer>(this.project.stateUrl, { responseType: 'arraybuffer' });
      const projectStateContent = projectState.data.toString();
      const projectTimestamp = timestampToUnix(fetchTimestampValue(projectStateContent));

      // skip if tile update time is later than project update time
      if (details.updatedAt >= projectTimestamp) {
        this.logger.info({ msg: 'skipping tile processing', tile, tileDetails: details, sourceUpdatedAt: projectTimestamp });
        if (detilerGetTimerEnd) {
          detilerGetTimerEnd();
        }

        return true;
      }
    }

    if (detilerGetTimerEnd) {
      detilerGetTimerEnd();
    }

    return false;
  }

  private async postProcess(tile: TileWithMetadata, timestamp: number): Promise<void> {
    if (this.detiler === undefined) {
      return;
    }

    const detilerSetTimerEnd = this.tilesDurationHistogram?.startTimer({ kind: 'detilerSet' });

    await this.detiler.setTileDetails({ kit: this.project.name, z: tile.z, x: tile.x, y: tile.y }, { state: tile.state, timestamp });

    if (detilerSetTimerEnd) {
      detilerSetTimerEnd();
    }
  }
}
