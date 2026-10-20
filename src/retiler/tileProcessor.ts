import { type Registry } from 'prom-client';
import { type Logger } from '@map-colonies/js-logger';
import { type IDetilerClient } from '@map-colonies/detiler-client';
import { inject, injectable } from 'tsyringe';
import { type AxiosInstance } from 'axios';
import { type Tracer, type Span, type Attributes } from '@opentelemetry/api';
import { type ConfigType } from '@src/common/config';
import { jobAttributes, spanName } from '@src/common/tracing/job';
import { MAP_PROVIDER, MAP_SPLITTER_PROVIDER, METRICS_BUCKETS, METRICS_REGISTRY, SERVICES, TILES_STORAGE_PROVIDERS } from '../common/constants';
import { endMetricTimer, MetatileStatus, ProcessKind, SubTileStatus } from '../common/metrics';
import { type ITileProcessor, type MapProvider, type MapSplitterProvider, type TilesStorageProvider } from './interfaces';
import { createTileProcessingMetrics, TileLifecycle, type TileProcessingMetrics, withSpan } from './processingUtils';
import { TileWithMetadata } from './types';

@injectable()
export class TileProcessor implements ITileProcessor {
  private readonly mapProviderName?: string;
  private readonly shouldFilterBlankTiles?: boolean;
  private readonly metrics: TileProcessingMetrics;
  private readonly lifecycle: TileLifecycle;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.TRACER) private readonly tracer: Tracer,
    @inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @inject(MAP_SPLITTER_PROVIDER) private readonly mapSplitter: MapSplitterProvider,
    @inject(TILES_STORAGE_PROVIDERS) private readonly tilesStorageProviders: TilesStorageProvider[],
    @inject(SERVICES.HTTP_CLIENT) axiosClient: AxiosInstance,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.DETILER) detiler?: IDetilerClient,
    @inject(METRICS_REGISTRY) registry?: Registry,
    @inject(METRICS_BUCKETS) metricsBuckets?: number[]
  ) {
    this.mapProviderName = config.get('app.map.provider');
    this.shouldFilterBlankTiles = config.get('app.tilesStorage.shouldFilterBlankTiles');
    this.metrics = createTileProcessingMetrics(registry, metricsBuckets);
    this.lifecycle = new TileLifecycle(logger, tracer, axiosClient, config, this.metrics, detiler);
  }

  public async processTile(tile: TileWithMetadata): Promise<void> {
    return this.lifecycle.run(tile, this.mapProviderName, async () => {
      const mapBuffer = await this.fetchMap(tile);
      const { splittedTiles, isMetatileBlank, blankTiles, outOfBoundsCount } = await this.splitMap(tile, mapBuffer);

      if (splittedTiles.length > 0) {
        await this.storeSplittedTiles(splittedTiles);
      }

      if (blankTiles.length > 0) {
        await this.deleteBlankTiles(tile, blankTiles);
      }

      if (isMetatileBlank) {
        this.metrics.tilesCounter?.inc({ status: MetatileStatus.BLANK, z: tile.z });
      }
      this.metrics.subTilesCounter?.inc({ status: SubTileStatus.STORED, z: tile.z }, splittedTiles.length);
      this.metrics.subTilesCounter?.inc({ status: SubTileStatus.BLANK, z: tile.z }, blankTiles.length);
      this.metrics.subTilesCounter?.inc({ status: SubTileStatus.OUT_OF_BOUNDS, z: tile.z }, outOfBoundsCount);
    });
  }

  private async fetchMap(tile: TileWithMetadata): Promise<Buffer> {
    const fetchTimerEnd = this.metrics.tilesDurationHistogram?.startTimer({ kind: ProcessKind.FETCH, z: tile.z });
    const mapBuffer = await this.withSpan(spanName.TILE_FETCH, {}, async () => this.mapProvider.getMap(tile));
    endMetricTimer(fetchTimerEnd);
    return mapBuffer;
  }

  private async splitMap(tile: TileWithMetadata, mapBuffer: Buffer): Promise<Awaited<ReturnType<MapSplitterProvider['splitMap']>>> {
    const splitTimerEnd = this.metrics.tilesDurationHistogram?.startTimer({ kind: ProcessKind.SPLIT });
    const result = await this.withSpan(spanName.TILE_SPLIT, {}, async (innerSpan) => {
      const splitResult = await this.mapSplitter.splitMap({ ...tile, buffer: mapBuffer }, this.shouldFilterBlankTiles);
      innerSpan.setAttributes({
        [jobAttributes.TILES_STORED_COUNT]: splitResult.splittedTiles.length,
        [jobAttributes.TILES_BLANK_COUNT]: splitResult.blankTiles.length,
        [jobAttributes.TILES_OUT_OF_BOUNDS_COUNT]: splitResult.outOfBoundsCount,
      });
      return splitResult;
    });
    endMetricTimer(splitTimerEnd);
    return result;
  }

  private async storeSplittedTiles(splittedTiles: Awaited<ReturnType<MapSplitterProvider['splitMap']>>['splittedTiles']): Promise<void> {
    this.logger.debug({
      msg: 'storing tiles',
      count: splittedTiles.length,
      providersCount: this.tilesStorageProviders.length,
      tiles: splittedTiles.map((t) => `${t.z}/${t.x}/${t.y}`),
    });
    const storeTimerEnd = this.metrics.tilesDurationHistogram?.startTimer({ kind: ProcessKind.STORE });
    await this.withSpan(spanName.TILE_STORE, { [jobAttributes.TILES_STORED_COUNT]: splittedTiles.length }, async () => {
      await Promise.all(
        this.tilesStorageProviders.map(async (tilesStorageProv) => {
          for (const subTile of splittedTiles) {
            this.logger.debug({ msg: 'storing subtile', z: subTile.z, x: subTile.x, y: subTile.y });
            await this.withSpan('tile.store.single', { 'tile.z': subTile.z, 'tile.x': subTile.x, 'tile.y': subTile.y }, async () => {
              await tilesStorageProv.storeTiles([structuredClone(subTile)]);
            });
          }
        })
      );
    });
    endMetricTimer(storeTimerEnd);
  }

  private async deleteBlankTiles(
    tile: TileWithMetadata,
    blankTiles: Awaited<ReturnType<MapSplitterProvider['splitMap']>>['blankTiles']
  ): Promise<void> {
    this.logger.debug({
      msg: 'deleting tiles',
      count: blankTiles.length,
      providersCount: this.tilesStorageProviders.length,
      tiles: blankTiles.map((t) => `${t.z}/${t.x}/${t.y}`),
    });
    const deleteTimerEnd = this.metrics.tilesDurationHistogram?.startTimer({ kind: ProcessKind.DELETE });
    await this.withSpan(
      spanName.TILE_DELETE,
      {
        [jobAttributes.TILES_BLANK_COUNT]: blankTiles.length,
        [jobAttributes.TILE_Z]: tile.z,
        [jobAttributes.TILE_X]: tile.x,
        [jobAttributes.TILE_Y]: tile.y,
      },
      async () => {
        await Promise.all(
          this.tilesStorageProviders.map(async (tilesStorageProv) => {
            for (const blankTile of blankTiles) {
              this.logger.debug({ msg: 'deleting subtile', z: blankTile.z, x: blankTile.x, y: blankTile.y });
              await this.withSpan('tile.delete.single', { 'tile.z': blankTile.z, 'tile.x': blankTile.x, 'tile.y': blankTile.y }, async () => {
                await tilesStorageProv.deleteTiles([blankTile]);
              });
            }
          })
        );
      }
    );
    endMetricTimer(deleteTimerEnd);
  }

  private async withSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
    return withSpan(this.tracer, name, attributes, fn);
  }
}
