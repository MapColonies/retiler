import { RequestOptions } from 'https';
import { Readable } from 'stream';
import { ObjectCannedACL } from '@aws-sdk/client-s3';
import { Tile } from '@map-colonies/tile-calc';
import { Job } from './jobsQueueProvider/interfaces';
import { HttpResponse } from './mapProvider/interfaces';
import { TileWithBuffer } from './types';

export interface JobsQueueProvider {
  get: <T>() => Promise<Job<T> | null>;
  isEmpty: () => Promise<boolean>;
  complete: (id: string) => Promise<void>;
  fail: ((id: string) => Promise<void>) & ((id: string, data: object) => Promise<void>);
}

export interface MapProvider {
  getMapStream: (options: string | RequestOptions | URL) => Promise<Readable>;
  getMap?: (options: string | RequestOptions | URL) => Promise<HttpResponse<Buffer>>;
}

export interface MapSplitterProvider {
  splitMap: (tile: Tile, stream: Readable) => Promise<TileWithBuffer[]>;
}

export interface TilesStorageProvider {
  set: (key: string, body: Buffer, acl?: ObjectCannedACL | string) => Promise<void>;
}
