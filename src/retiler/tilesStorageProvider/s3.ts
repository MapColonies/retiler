/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Tile } from '@map-colonies/tile-calc';
import Format from 'string-format';
import { inject, injectable } from 'tsyringe';
import { S3_BUCKET, SERVICES, TILES_STORAGE_LAYOUT } from '../../common/constants';
import { S3Error } from '../../common/errors';
import { TilesStorageProvider } from '../interfaces';
import { TileWithBuffer } from '../types';
import { getFlippedY } from '../util';
import { TileStoragLayout } from './interfaces';

@injectable()
export class S3TilesStorage implements TilesStorageProvider {
  public constructor(
    @inject(SERVICES.S3) private readonly s3Client: S3Client,
    @inject(S3_BUCKET) private readonly bucket: string,
    @inject(TILES_STORAGE_LAYOUT) private readonly storageLayout: TileStoragLayout
  ) {}

  public async storeTile(tile: TileWithBuffer): Promise<void> {
    const key = this.determineKey(tile);
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: tile.buffer });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      throw new S3Error(`an error occurred during the put of key ${key} on bucket ${this.bucket}, ${s3Error.message}`);
    }
  }

  private determineKey(tile: Tile): string {
    if (this.storageLayout.shouldFlipY) {
      tile.y = getFlippedY(tile);
    }
    const key = Format(this.storageLayout.format, tile);
    return key;
  }
}
