/* eslint-disable @typescript-eslint/naming-convention */
export const jobAttributes = {
  TILE_Z: 'tile.z',
  TILE_X: 'tile.x',
  TILE_Y: 'tile.y',
  TILE_METATILE: 'tile.metatile',
  JOB_ID: 'job.id',
  TILE_FORCE: 'tile.force',
  TILE_STATE: 'tile.state',
  TILE_STATUS: 'tile.status',
  TILE_SKIP_REASON: 'tile.skip_reason',
  TILES_STORED_COUNT: 'tiles.stored_count',
  TILES_BLANK_COUNT: 'tiles.blank_count',
  TILES_OUT_OF_BOUNDS_COUNT: 'tiles.out_of_bounds_count',
  MAP_PROVIDER: 'map.provider',
  HTTP_STATUS: 'http.response.status_code',
  SHIGOLA_OPERATION: 'shigola.operation',
  SHIGOLA_OUTCOME: 'shigola.outcome',
  SHIGOLA_TILES_DONE: 'shigola.tiles.done',
  SHIGOLA_TILES_SKIPPED: 'shigola.tiles.skipped',
  SHIGOLA_TILES_FAILED: 'shigola.tiles.failed',
} satisfies Record<string, string>;

export const spanName = {
  TILE_PROCESS: 'tile.process',
  TILE_PREPROCESS: 'tile.pre_process',
  TILE_FETCH: 'tile.fetch',
  TILE_SPLIT: 'tile.split',
  TILE_STORE: 'tile.store',
  TILE_DELETE: 'tile.delete',
  TILE_POSTPROCESS: 'tile.post_process',
  JOB_PROCESS: 'job.process',
  SHIGOLA_CACHE: 'shigola.cache',
} satisfies Record<string, string>;
