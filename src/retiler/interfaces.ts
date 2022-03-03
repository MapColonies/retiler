import { IncomingMessage } from 'http';
import { RequestOptions } from 'https';
import { Duplex } from 'stream';
import { ObjectCannedACL } from '@aws-sdk/client-s3';
import { Tile } from '@map-colonies/tile-calc';
import { Job } from './jobsQueueProvider/interfaces';
import { HttpResponse } from './mapProvider/interfaces';

export interface JobsQueueProvider {
  get: <T>() => Promise<Job<T> | null>;
  complete: (id: string) => Promise<void>;
  fail: (id: string) => Promise<void>;
  isEmpty: () => Promise<boolean>;
}

export interface MapProvider {
  getMap: (options: string | RequestOptions | URL) => Promise<HttpResponse<Buffer>>;
  getMapStream: (options: string | RequestOptions | URL) => Promise<IncomingMessage>;
}

export interface MapSplitterProvider {
  generateSplitPipeline: (tile: Tile) => { promises: Promise<Buffer>[]; tiles: Tile[]; pipeline: Duplex }; //Promise<Duplex>;
}

export interface TilesStorageProvider {
  set: (key: string, body: Buffer, acl?: ObjectCannedACL | string) => Promise<void>;
}
