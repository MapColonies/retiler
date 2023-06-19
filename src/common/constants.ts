import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_LIVENESS_PORT = 8080;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/, /^.*\/metrics.*/];

export const PROJECT_NAME_SYMBOL = Symbol('projectName');
export const JOB_QUEUE_PROVIDER = Symbol('JobsQueueProvider');
export const MAP_PROVIDER = Symbol('MapProvider');
export const MAP_SPLITTER_PROVIDER = Symbol('MapSplitterProvider');
export const TILES_STORAGE_PROVIDER = Symbol('TilesStorageProvider');
export const METRICS_BUCKETS = Symbol('metrics_buckets');

export const CONSUME_AND_PROCESS_FACTORY = Symbol('ConsumeAndProcessFactory');
export const LIVENESS_PROBE_FACTORY = Symbol('LivenessProbeFactory');

export const QUEUE_NAME = Symbol('QueueName');
export const QUEUE_EMPTY_TIMEOUT = Symbol('QueueTimeout');
export const METRICS_REGISTRY = Symbol('MetricsRegistry');

export const MAP_URL = Symbol('MapURL');
export const MAP_FORMAT = Symbol('MapFormat');
export const MAP_PROVIDER_CONFIG = Symbol('MapProviderConfig');

export const S3_BUCKET = Symbol('S3Bucket');
export const TILES_STORAGE_LAYOUT = Symbol('TilesStorageLayout');

export const TILE_SIZE = 256;

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES: Record<string, symbol> = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METER: Symbol('Meter'),
  S3: Symbol('S3'),
  HTTP_CLIENT: Symbol('HttpClient'),
};

export const ExitCodes: Record<string, number> = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
};
