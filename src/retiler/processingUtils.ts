import { type Registry, Counter, Histogram } from 'prom-client';
import { type Logger } from '@map-colonies/js-logger';
import { type IDetilerClient } from '@map-colonies/detiler-client';
import { type AxiosInstance } from 'axios';
import { TILEGRID_WORLD_CRS84, tileToBoundingBox } from '@map-colonies/tile-calc';
import { type Tracer, type Span, type Attributes, SpanStatusCode } from '@opentelemetry/api';
import { type ConfigType } from '@src/common/config';
import { jobAttributes, spanName } from '@src/common/tracing/job';
import type { IProjectConfig } from '../common/interfaces';
import { fetchTimestampValue, timestampToUnix } from '../common/util';
import { MILLISECONDS_IN_SECOND } from '../common/constants';
import { endMetricTimer, MetatileStatus, ProcessKind, ProcessReason, ProcessSkipReason } from '../common/metrics';
import type { TileWithMetadata } from './types';

interface PreProcessReult {
  shouldSkipProcessing: boolean;
  reason?: ProcessReason | ProcessSkipReason;
}

export interface TileProcessingMetrics {
  tilesDurationHistogram?: Histogram<'z' | 'kind'>;
  tilesCounter?: Counter<'status' | 'z'>;
  subTilesCounter?: Counter<'status' | 'z'>;
  preProcessResultsCounter?: Counter<'result' | 'z'>;
}

export const createTileProcessingMetrics = (registry?: Registry, metricsBuckets?: number[]): TileProcessingMetrics => {
  if (registry === undefined) {
    return {};
  }

  return {
    tilesDurationHistogram: new Histogram({
      name: 'retiler_action_duration_seconds',
      help: 'Retiler action duration by kind, one of fetch, slice, store or purge.',
      buckets: metricsBuckets,
      labelNames: ['kind', 'z'] as const,
      registers: [registry],
    }),
    tilesCounter: new Counter({
      name: 'retiler_tiles_count',
      help: 'The total number of tiles processed',
      labelNames: ['status', 'z'] as const,
      registers: [registry],
    }),
    preProcessResultsCounter: new Counter({
      name: 'retiler_pre_process_results_count',
      help: 'The results of the pre process',
      labelNames: ['result', 'z'] as const,
      registers: [registry],
    }),
    subTilesCounter: new Counter({
      name: 'retiler_sub_tiles_count',
      help: 'The total number sub tiles processed or filtered',
      labelNames: ['status', 'z'] as const,
      registers: [registry],
    }),
  };
};

export const withSpan = async <T>(tracer: Tracer, name: string, attributes: Attributes, fn: (span: Span) => Promise<T>): Promise<T> => {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
};

export class TileLifecycle {
  private readonly project: IProjectConfig;
  private readonly forceProcess: boolean;
  private readonly detilerProceedOnFailure: boolean;

  public constructor(
    private readonly logger: Logger,
    private readonly tracer: Tracer,
    private readonly axiosClient: AxiosInstance,
    config: ConfigType,
    private readonly metrics: TileProcessingMetrics,
    private readonly detiler?: IDetilerClient
  ) {
    this.project = config.get('app.project');
    this.forceProcess = config.get('app.forceProcess');
    this.detilerProceedOnFailure = config.get('detiler.proceedOnFailure');
  }

  public async run(tile: TileWithMetadata, mapProvider: string | undefined, process: () => Promise<void>): Promise<void> {
    return withSpan(
      this.tracer,
      spanName.TILE_PROCESS,
      {
        [jobAttributes.TILE_Z]: tile.z,
        [jobAttributes.TILE_X]: tile.x,
        [jobAttributes.TILE_Y]: tile.y,
        [jobAttributes.TILE_METATILE]: tile.metatile,
        [jobAttributes.TILE_FORCE]: tile.force ?? false,
        [jobAttributes.TILE_STATE]: tile.state,
        [jobAttributes.MAP_PROVIDER]: mapProvider,
      },
      async (span) => {
        try {
          const preRenderTimestamp = Math.floor(Date.now() / MILLISECONDS_IN_SECOND);

          const { shouldSkipProcessing, reason } = await this.runPreProcess(tile, preRenderTimestamp);
          if (shouldSkipProcessing) {
            span.setAttribute(jobAttributes.TILE_STATUS, MetatileStatus.SKIPPED);
            span.setAttribute(jobAttributes.TILE_SKIP_REASON, reason ?? '');
            this.metrics.tilesCounter?.inc({ status: MetatileStatus.SKIPPED, z: tile.z });
            return;
          }

          await process();

          await this.runPostProcess(tile, preRenderTimestamp);

          this.metrics.tilesCounter?.inc({ status: MetatileStatus.COMPLETED, z: tile.z });
        } catch (error) {
          this.metrics.tilesCounter?.inc({ status: MetatileStatus.FAILED, z: tile.z });
          throw error;
        }
      }
    );
  }

  private async runPreProcess(tile: TileWithMetadata, preRenderTimestamp: number): Promise<PreProcessReult> {
    return withSpan(this.tracer, spanName.TILE_PREPROCESS, {}, async (innerSpan) => {
      const result = await this.preProcess(tile, preRenderTimestamp);
      innerSpan.setAttribute(jobAttributes.TILE_SKIP_REASON, result.reason ?? '');
      return result;
    });
  }

  private async runPostProcess(tile: TileWithMetadata, preRenderTimestamp: number): Promise<void> {
    await withSpan(this.tracer, spanName.TILE_POSTPROCESS, {}, async () => this.postProcess(tile, preRenderTimestamp));
  }

  private async preProcess(tile: TileWithMetadata, timestamp: number): Promise<PreProcessReult> {
    let preProcessTimerEnd;
    let result: PreProcessReult = { shouldSkipProcessing: false };

    try {
      const isForced = this.forceProcess || tile.force === true;

      if (isForced || this.detiler === undefined) {
        result = { shouldSkipProcessing: false, reason: isForced ? ProcessReason.FORCE : ProcessReason.NO_DETILER };
        return result;
      }

      preProcessTimerEnd = this.metrics.tilesDurationHistogram?.startTimer({ kind: ProcessKind.PRE_PROCESS });

      const tileDetails = await this.detiler.getTileDetails({ kit: this.project.name, z: tile.z, x: tile.x, y: tile.y });
      if (tileDetails !== null) {
        const projectState = await this.axiosClient.get<Buffer>(this.project.stateUrl, { responseType: 'arraybuffer' });
        const projectStateContent = projectState.data.toString();
        const projectTimestamp = timestampToUnix(fetchTimestampValue(projectStateContent));

        this.logger.info({ msg: 'determining if should skip tile processing', tile, tileDetails, sourceUpdatedAt: projectTimestamp });

        if (tileDetails.renderedAt >= projectTimestamp) {
          await this.detiler.setTileDetails(
            { kit: this.project.name, z: tile.z, x: tile.x, y: tile.y },
            { status: 'skipped', state: tile.state, timestamp }
          );

          this.logger.info({
            msg: 'tile processing can be skipping due to tile being up do date',
            tile,
            tileDetails,
            sourceUpdatedAt: projectTimestamp,
          });

          result = { shouldSkipProcessing: true, reason: ProcessSkipReason.TILE_UP_TO_DATE };

          return result;
        }

        const { west, south, east, north } = tileToBoundingBox(tile, TILEGRID_WORLD_CRS84, true);

        const cooled = timestamp - tileDetails.renderedAt;

        const cooldownsGenerator = this.detiler.queryCooldownsAsyncGenerator({
          enabled: true,
          minZoom: tile.z,
          maxZoom: tile.z,
          kits: [this.project.name],
          area: [west, south, east, north],
        });

        for await (const cooldowns of cooldownsGenerator) {
          const isCooling = cooldowns.filter((cooldown) => cooldown.duration > cooled).length > 0;

          this.logger.info({
            msg: 'tile processing should be skipped due to active cooldown',
            tile,
            tileDetails,
            tileCooled: cooled,
            cooldowns,
            sourceUpdatedAt: projectTimestamp,
          });

          if (isCooling) {
            await this.detiler.setTileDetails(
              { kit: this.project.name, z: tile.z, x: tile.x, y: tile.y },
              { status: 'cooled', state: tile.state, timestamp }
            );

            result = { shouldSkipProcessing: true, reason: ProcessSkipReason.COOLDOWN };

            return result;
          }
        }
      }

      result = { shouldSkipProcessing: false, reason: ProcessReason.PROJECT_UPDATED };

      return result;
    } catch (error) {
      this.logger.error({ msg: 'an error occurred while pre processing, tile will be processed', err: error });

      result = { shouldSkipProcessing: false, reason: ProcessReason.ERROR_OCCURRED };

      return result;
    } finally {
      this.logger.info({ msg: 'pre processing done', tile, result });

      this.metrics.preProcessResultsCounter?.inc({ result: result.reason, z: tile.z });

      endMetricTimer(preProcessTimerEnd);
    }
  }

  private async postProcess(tile: TileWithMetadata, timestamp: number): Promise<void> {
    if (this.detiler === undefined) {
      return;
    }

    const postProcessTimerEnd = this.metrics.tilesDurationHistogram?.startTimer({ kind: ProcessKind.POST_PROCESS });

    try {
      await this.detiler.setTileDetails(
        { kit: this.project.name, z: tile.z, x: tile.x, y: tile.y },
        { status: 'rendered', state: tile.state, timestamp }
      );
    } catch (error) {
      this.logger.error({ msg: 'an error occurred while post processing, skipping details set', err: error });
      if (!this.detilerProceedOnFailure) {
        throw error;
      }
    } finally {
      endMetricTimer(postProcessTimerEnd);
    }
  }
}
