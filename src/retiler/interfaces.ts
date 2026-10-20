import type { MapSplitResult, TileWithBuffer, TileWithMetadata } from './types';

export interface JobQueueProvider {
  activeQueueName: string;
  consumeQueue: <T, R = void>(fn: (value: T, jobId?: string) => Promise<R>, parallelism?: number) => Promise<void>;
  startQueue: () => Promise<void>;
  stopQueue: () => Promise<void>;
}

export interface MapProvider {
  getMap: (tile: TileWithMetadata) => Promise<Buffer>;
}

export interface ITileProcessor {
  processTile: (tile: TileWithMetadata) => Promise<void>;
}

export interface CachePurger {
  sendPurgeRequest: (tile: TileWithMetadata) => Promise<void>;
}

export interface MapSplitterProvider {
  splitMap: (tile: TileWithBuffer, filterBlanks?: boolean) => Promise<MapSplitResult>;
}

export interface TilesStorageProvider {
  storeTile: (tile: TileWithBuffer) => Promise<void>;
  storeTiles: (tiles: TileWithBuffer[]) => Promise<void>;
  deleteTiles: (tiles: TileWithMetadata[]) => Promise<void>;
}
