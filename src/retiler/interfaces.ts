import { BoundingBox, Tile } from '@map-colonies/tile-calc';
import { TileWithBuffer } from './types';

export interface JobQueueProvider {
  activeQueueName: string;
  consumeQueue: <T1, T2 = void>(fn: (value: T1) => Promise<T2>) => Promise<void>;
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
  storeTiles: (tile: TileWithBuffer[]) => Promise<void>;
}
