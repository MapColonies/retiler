import { BoundingBox, Tile } from '@map-colonies/tile-calc';
import { Job } from './jobQueueProvider/interfaces';
import { TileWithBuffer } from './types';

export interface JobQueueProvider {
  get: <T>() => Promise<Job<T> | null>;
  isEmpty: () => Promise<boolean>;
  complete: (id: string, data?: object) => Promise<void>;
  fail: (id: string, data?: object) => Promise<void>;
  startQueue: () => Promise<void>;
  stopQueue: () => Promise<void>;
}

export interface MapProvider {
  getMap: (bbox: BoundingBox, mapWidth: number, mapHeight: number) => Promise<Buffer>;
}

export interface MapSplitterProvider {
  splitMap: (tile: Tile, buffer: Buffer) => Promise<TileWithBuffer[]>;
}

export interface TilesStorageProvider {
  storeTile: (tile: TileWithBuffer) => Promise<void>;
}
