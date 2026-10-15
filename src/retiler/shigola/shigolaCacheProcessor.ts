import { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { StatusCodes } from 'http-status-codes';
import { Counter, Histogram, Registry } from 'prom-client';
import { TILEGRID_WORLD_CRS84, tileToBoundingBox, type Tile } from '@map-colonies/tile-calc';
import { type Logger } from '@map-colonies/js-logger';
import { type Span, SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { inject, injectable } from 'tsyringe';
import { jobAttributes, spanName } from '@src/common/tracing/job';
import { MAP_URL, METRICS_BUCKETS, METRICS_REGISTRY, SERVICES, SHIGOLA_CONFIG } from '../../common/constants';
import { NonRetryableError } from '../../common/errors';
import { endMetricTimer, ShigolaOutcome, ShigolaTileResult } from '../../common/metrics';
import { timerify } from '../../common/util';
import { MetatileProcessor } from '../interfaces';
import { TileWithMetadata } from '../types';
import type { ShigolaCacheRequest, ShigolaCacheResponse, ShigolaConfig, ShigolaErrorResponse, ShigolaOperation } from './types';

const NO_HTTP_STATUS = 'none';
const CLIENT_ERROR_MIN: number = StatusCodes.BAD_REQUEST;
const SERVER_ERROR_MIN: number = StatusCodes.INTERNAL_SERVER_ERROR;
// a missing or rotated token, or a wrong admin url (shigola reports a bad request as 400 or 422, never 404),
// is fixed by a deploy rather than by changing the job, so it is retried instead of losing every metatile meanwhile
const RETRYABLE_CLIENT_ERRORS: number[] = [StatusCodes.UNAUTHORIZED, StatusCodes.FORBIDDEN, StatusCodes.NOT_FOUND, StatusCodes.TOO_MANY_REQUESTS];

/**
 * Keeps Shigola's tile cache fresh in place of the TileProcessor: each metatile becomes one request to
 * Shigola's Cache Admin API with the metatile's bbox and zoom, and Shigola purges or renders the tiles
 * in its own cache. Nothing is fetched, split or stored by retiler, and detiler is not used.
 */
@injectable()
export class ShigolaCacheProcessor implements MetatileProcessor {
  private readonly requestUrl: string;
  private readonly requestConfig: AxiosRequestConfig;
  private readonly requestsCounter?: Counter<'operation' | 'outcome' | 'code'>;
  private readonly tilesCounter?: Counter<'operation' | 'result'>;
  private readonly requestDurationHistogram?: Histogram<'operation' | 'z'>;

  public constructor(
    @inject(SERVICES.HTTP_CLIENT) private readonly axiosClient: AxiosInstance,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.TRACER) private readonly tracer: Tracer,
    @inject(MAP_URL) mapUrl: string,
    @inject(SHIGOLA_CONFIG) private readonly shigolaConfig: ShigolaConfig,
    @inject(METRICS_REGISTRY) registry?: Registry,
    @inject(METRICS_BUCKETS) metricsBuckets?: number[]
  ) {
    const { operation, token, timeoutMs, targets, tileMatrixSets } = shigolaConfig;
    this.requestUrl = new URL(`cache/${operation}`, mapUrl.endsWith('/') ? mapUrl : `${mapUrl}/`).toString();

    const hasToken = token !== undefined && token !== '';
    this.requestConfig = { timeout: timeoutMs, ...(hasToken && { headers: { authorization: `Bearer ${token}` } }) };

    if (registry !== undefined) {
      this.requestsCounter = new Counter({
        name: 'retiler_shigola_requests_count',
        help: 'The total number of Shigola Cache Admin API requests by operation, outcome and http status',
        labelNames: ['operation', 'outcome', 'code'] as const,
        registers: [registry],
      });

      this.tilesCounter = new Counter({
        name: 'retiler_shigola_tiles_count',
        help: 'The total number of tiles Shigola reported as done (purged or seeded), skipped or failed',
        labelNames: ['operation', 'result'] as const,
        registers: [registry],
      });

      this.requestDurationHistogram = new Histogram({
        name: 'retiler_shigola_request_duration_seconds',
        help: 'Shigola Cache Admin API request duration by operation',
        buckets: metricsBuckets,
        labelNames: ['operation', 'z'] as const,
        registers: [registry],
      });
    }

    this.logger.info({
      msg: 'initializing shigola cache processor',
      mapUrl,
      requestUrl: this.requestUrl,
      operation,
      targets,
      tileMatrixSets,
      timeoutMs,
      hasToken,
    });
  }

  public async processTile(tile: TileWithMetadata): Promise<void> {
    const { operation } = this.shigolaConfig;
    const { parent, ...baseTile } = tile;

    const attributes = {
      [jobAttributes.TILE_Z]: tile.z,
      [jobAttributes.TILE_X]: tile.x,
      [jobAttributes.TILE_Y]: tile.y,
      [jobAttributes.TILE_METATILE]: tile.metatile,
      [jobAttributes.MAP_PROVIDER]: 'shigola',
      [jobAttributes.SHIGOLA_OPERATION]: operation,
    };

    return this.tracer.startActiveSpan(spanName.SHIGOLA_CACHE, { attributes }, async (span) => {
      const timerEnd = this.requestDurationHistogram?.startTimer({ operation, z: tile.z });
      try {
        const body = this.buildRequest(baseTile);

        this.logger.debug({ msg: 'requesting shigola cache operation', tile: baseTile, parent, requestUrl: this.requestUrl, body });

        const [response, duration] = await timerify<AxiosResponse<ShigolaCacheResponse>, [string, ShigolaCacheRequest, AxiosRequestConfig]>(
          this.axiosClient.post.bind(this.axiosClient),
          this.requestUrl,
          body,
          this.requestConfig
        );

        const { seeded, purged, skipped, failed } = response.data;
        const done = seeded ?? purged ?? 0;

        span.setAttributes({
          [jobAttributes.SHIGOLA_TILES_DONE]: done,
          [jobAttributes.SHIGOLA_TILES_SKIPPED]: skipped,
          [jobAttributes.SHIGOLA_TILES_FAILED]: failed,
        });
        this.tilesCounter?.inc({ operation, result: ShigolaTileResult.DONE }, done);
        this.tilesCounter?.inc({ operation, result: ShigolaTileResult.SKIPPED }, skipped);
        this.tilesCounter?.inc({ operation, result: ShigolaTileResult.FAILED }, failed);

        this.recordOutcome(span, operation, ShigolaOutcome.COMPLETED, response.status);
        this.logger.info({ msg: 'shigola cache operation completed', tile: baseTile, parent, operation, duration, done, skipped, failed });
      } catch (err) {
        const httpStatus = (err as Partial<AxiosError> | undefined)?.response?.status;
        const error = this.classifyError(err, operation, httpStatus);
        const outcome = error instanceof NonRetryableError ? ShigolaOutcome.REJECTED : ShigolaOutcome.FAILED;

        this.recordOutcome(span, operation, outcome, httpStatus);
        span.recordException(error);
        this.logger.error({
          msg: 'shigola cache operation failed',
          err: error,
          outcome,
          httpStatus,
          tile: baseTile,
          parent,
          requestUrl: this.requestUrl,
        });

        throw error;
      } finally {
        endMetricTimer(timerEnd);
        span.end();
      }
    });
  }

  private buildRequest(tile: Required<Tile>): ShigolaCacheRequest {
    const { operation, targets, tileMatrixSets } = this.shigolaConfig;

    // clamped, as a metatile may reach past the grid and shigola refuses bounds outside lng/lat
    const { west, south, east, north } = tileToBoundingBox(tile, TILEGRID_WORLD_CRS84, true);

    return {
      bounds: [west, south, east, north],
      zoomRange: { min: tile.z, max: tile.z },
      targets,
      ...(tileMatrixSets !== undefined && { tileMatrixSets }),
      ...(operation === 'seed' && { overwrite: true }),
    };
  }

  /**
   * A 4xx that repeating the request cannot fix (a bad bbox, an unknown map, too many tiles) becomes a
   * NonRetryableError. Anything else, including 429, an auth failure and a 404, is left for the queue to retry.
   */
  private classifyError(err: unknown, operation: ShigolaOperation, httpStatus: number | undefined): Error {
    const error = err instanceof Error ? err : new Error(String(err));

    if (httpStatus === undefined || httpStatus < CLIENT_ERROR_MIN || httpStatus >= SERVER_ERROR_MIN || RETRYABLE_CLIENT_ERRORS.includes(httpStatus)) {
      return error;
    }

    // the body is shigola's {error}, unless a proxy in front of it answered
    const reason = (err as AxiosError<ShigolaErrorResponse | undefined>).response?.data?.error ?? error.message;
    return new NonRetryableError(`shigola refused the ${operation} request with status ${httpStatus}: ${reason}`, { cause: err });
  }

  private recordOutcome(span: Span, operation: ShigolaOperation, outcome: ShigolaOutcome, httpStatus: number | undefined): void {
    span.setAttribute(jobAttributes.SHIGOLA_OUTCOME, outcome);
    if (httpStatus !== undefined) {
      span.setAttribute(jobAttributes.HTTP_STATUS, httpStatus);
    }
    span.setStatus({ code: outcome === ShigolaOutcome.COMPLETED ? SpanStatusCode.OK : SpanStatusCode.ERROR });
    this.requestsCounter?.inc({ operation, outcome, code: httpStatus ?? NO_HTTP_STATUS });
  }
}
