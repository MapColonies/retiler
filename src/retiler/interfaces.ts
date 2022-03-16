import { Readable } from 'stream';
import { ObjectCannedACL } from '@aws-sdk/client-s3';
import { BoundingBox, Tile } from '@map-colonies/tile-calc';
import { Job } from './jobsQueueProvider/interfaces';
import { TileWithBuffer } from './types';

export interface JobsQueueProvider {
  get: <T>() => Promise<Job<T> | null>;
  isEmpty: () => Promise<boolean>;
  complete: (id: string) => Promise<void>;
  fail: ((id: string) => Promise<void>) & ((id: string, data: object) => Promise<void>);
}

export interface MapProvider {
  getMapStream: (bbox: BoundingBox, mapWidth: number, mapHeight: number) => Promise<Readable>;
}

export interface MapSplitterProvider {
  splitMap: (tile: Tile, stream: Readable) => Promise<TileWithBuffer[]>;
}

export interface TilesStorageProvider {
  storeTile: (tile:TileWithBuffer) => Promise<void>;
}
