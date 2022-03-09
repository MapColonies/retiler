import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_SERVER_PORT = 8080;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

export const PROJECT_NAME_SYMBOL = Symbol('projectName');
export const JOBS_QUEUE_PROVIDER = Symbol('JobsQueueProvider');
export const MAP_PROVIDER = Symbol('MapProvider');
export const MAP_SPLITTER_PROVIDER = Symbol('MapSplitterProvider');
export const TILES_STORAGE_PROVIDER = Symbol('TilesStorageProvider');

export const QUEUE_NAME = Symbol('QueueName');

export const DB_OPTIONS = Symbol('DbOptions');

export const MAP_URL = Symbol('MapURL');

export const S3_CLIENT_CONFIG = Symbol('S3Clientconfig');
export const S3_BUCKET = Symbol('S3Bucket');
export const REVERSE_Y = Symbol('ReverseY');
export const TILE_LAYOUT = Symbol('TileLayout');

export const DEFAULT_TILE_SIZE = 256;

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES: Record<string, symbol> = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METER: Symbol('Meter'),
};

export const ExitCodes: Record<string, number> = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  S3_ERROR: 101,
  REMOTE_SERVICE_RESPONSE_ERROR: 103,
  REMOTE_SERVICE_UNAVAILABLE: 104,
};
/* eslint-enable @typescript-eslint/naming-convention */
