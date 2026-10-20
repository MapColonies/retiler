import { type Registry } from 'prom-client';
import { type Logger } from '@map-colonies/js-logger';
import { type IDetilerClient } from '@map-colonies/detiler-client';
import { inject, injectable } from 'tsyringe';
import { type AxiosInstance } from 'axios';
import { type Tracer } from '@opentelemetry/api';
import { type ConfigType } from '@src/common/config';
import { spanName } from '@src/common/tracing/job';
import { CACHE_PURGER, METRICS_BUCKETS, METRICS_REGISTRY, SERVICES } from '../common/constants';
import { endMetricTimer, ProcessKind } from '../common/metrics';
import { type CachePurger, type ITileProcessor } from './interfaces';
import { createTileProcessingMetrics, TileLifecycle, type TileProcessingMetrics, withSpan } from './processingUtils';
import { TileWithMetadata } from './types';

@injectable()
export class CachePurgerTileProcessor implements ITileProcessor {
  private readonly metrics: TileProcessingMetrics;
  private readonly lifecycle: TileLifecycle;

  public constructor(
    @inject(SERVICES.LOGGER) logger: Logger,
    @inject(SERVICES.TRACER) private readonly tracer: Tracer,
    @inject(CACHE_PURGER) private readonly cachePurger: CachePurger,
    @inject(SERVICES.HTTP_CLIENT) axiosClient: AxiosInstance,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.DETILER) detiler?: IDetilerClient,
    @inject(METRICS_REGISTRY) registry?: Registry,
    @inject(METRICS_BUCKETS) metricsBuckets?: number[]
  ) {
    this.metrics = createTileProcessingMetrics(registry, metricsBuckets);
    this.lifecycle = new TileLifecycle(logger, tracer, axiosClient, config, this.metrics, detiler);
  }

  public async processTile(tile: TileWithMetadata): Promise<void> {
    return this.lifecycle.run(tile, 'cachePurger', async () => {
      const purgeTimerEnd = this.metrics.tilesDurationHistogram?.startTimer({ kind: ProcessKind.PURGE, z: tile.z });
      await withSpan(this.tracer, spanName.TILE_PURGE, {}, async () => this.cachePurger.sendPurgeRequest(tile));
      endMetricTimer(purgeTimerEnd);
    });
  }
}
