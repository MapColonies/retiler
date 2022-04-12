/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@map-colonies/js-logger';
import { Tile } from '@map-colonies/tile-calc';
import Format from 'string-format';
import { inject, injectable } from 'tsyringe';
import { S3_BUCKET, SERVICES, TILES_STORAGE_LAYOUT } from '../../common/constants';
import { timerify } from '../../common/util';
import { TilesStorageProvider } from '../interfaces';
import { TileWithBuffer } from '../types';
import { getFlippedY } from '../util';
import { TileStoragLayout } from './interfaces';

@injectable()
export class S3TilesStorage implements TilesStorageProvider {
  public constructor(
    @inject(SERVICES.S3) private readonly s3Client: S3Client,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(S3_BUCKET) private readonly bucket: string,
    @inject(TILES_STORAGE_LAYOUT) private readonly storageLayout: TileStoragLayout
  ) {}

  public async storeTile(tileWithBuffer: TileWithBuffer): Promise<void> {
    const { buffer, parent, ...baseTile } = tileWithBuffer;

    this.logger.debug({ msg: `storing tile in bucket ${this.bucket}`, tile: baseTile, parent });

    const key = this.determineKey(baseTile);
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      throw new Error(`an error occurred during the put of key ${key} on bucket ${this.bucket}, ${s3Error.message}`);
    }
  }

  public async storeTiles(tiles: TileWithBuffer[]): Promise<void> {
    const parent = tiles[0].parent;
    this.logger.debug({ msg: `storing ${tiles.length} tiles in bucket ${this.bucket}`, parent });

    const [, duration] = await timerify(async () => Promise.all(tiles.map(async (tile) => this.storeTile(tile))));

    this.logger.debug({ msg: 'finished storing tiles', duration, parent });
  }

  private determineKey(tile: Tile): string {
    if (this.storageLayout.shouldFlipY) {
      tile.y = getFlippedY(tile);
    }
    const key = Format(this.storageLayout.format, tile);
    return key;
  }
}
