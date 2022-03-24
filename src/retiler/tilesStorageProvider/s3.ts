/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { inject, injectable } from 'tsyringe';
import { S3_BUCKET, SERVICES, TILE_PATH_LAYOUT } from '../../common/constants';
import { S3Error } from '../../common/errors';
import { TilesStorageProvider } from '../interfaces';
import { TilePathLayout, tileToPathLayout } from '../tilesPath';
import { TileWithBuffer } from '../types';

@injectable()
export class S3TilesStorage implements TilesStorageProvider {
  public constructor(
    @inject(SERVICES.S3) private readonly s3Client: S3Client,
    @inject(S3_BUCKET) private readonly bucket: string,
    @inject(TILE_PATH_LAYOUT) private readonly tilePathLayout: TilePathLayout,
  ) {}

  public async storeTile(tile: TileWithBuffer): Promise<void> {
    const key = tileToPathLayout(tile, this.tilePathLayout.tileLayout, `${this.tilePathLayout.prefix}`, undefined, 'png');
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: tile.buffer });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      throw new S3Error(`an error occurred during the put of key ${key} on bucket ${this.bucket}, ${s3Error.message}`);
    }
  }
}
