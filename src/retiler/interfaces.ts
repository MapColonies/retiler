import { TileWithBuffer, TileWithMetadata } from './types';

export interface JobQueueProvider {
  activeQueueName: string;
  consumeQueue: <T, R = void>(fn: (value: T, jobId?: string) => Promise<R>) => Promise<void>;
  startQueue: () => Promise<void>;
  stopQueue: () => Promise<void>;
}

export interface MapProvider {
  getMap: (tile: TileWithMetadata) => Promise<Buffer>;
}

export interface MapSplitterProvider {
  splitMap: (tile: TileWithBuffer) => Promise<TileWithBuffer[]>;
}

export interface TilesStorageProvider {
  storeTile: (tile: TileWithBuffer) => Promise<void>;
  storeTiles: (tiles: TileWithBuffer[]) => Promise<void>;
}
