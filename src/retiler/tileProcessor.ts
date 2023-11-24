import client from 'prom-client';
import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { MAP_PROVIDER, MAP_SPLITTER_PROVIDER, METRICS_BUCKETS, METRICS_REGISTRY, SERVICES, TILES_STORAGE_PROVIDERS } from '../common/constants';
import { MapProvider, MapSplitterProvider, TilesStorageProvider } from './interfaces';
import { TileWithMetadata } from './types';

@injectable()
export class TileProcessor {
  private readonly tilesCounter?: client.Counter<'status' | 'z'>;

  private readonly tilesDurationHistogram?: client.Histogram<'z' | 'kind'>;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @inject(MAP_SPLITTER_PROVIDER) private readonly mapSplitter: MapSplitterProvider,
    @inject(TILES_STORAGE_PROVIDERS) private readonly tilesStorageProviders: TilesStorageProvider[],
    @inject(METRICS_REGISTRY) registry?: client.Registry,
    @inject(METRICS_BUCKETS) metricsBuckets?: number[]
  ) {
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

      this.tilesCounter?.inc({ status: 'completed', z: tile.z });
    } catch (error) {
      this.tilesCounter?.inc({ status: 'failed', z: tile.z });
      throw error;
    }
  }
}
