/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { ObjectCannedACL, PutObjectCommand, S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import { inject, injectable } from 'tsyringe';
import { S3_BUCKET, S3_CLIENT_CONFIG } from '../../common/constants';
import { S3Error } from '../../common/errors';
import { ShutdownHandler } from '../../common/shutdownHandler';
import { TilesStorageProvider } from '../interfaces';

@injectable()
export class S3TilesStorage implements TilesStorageProvider {
  private readonly s3Client: S3Client;

  public constructor(
    @inject(ShutdownHandler) private readonly shutdownHandler: ShutdownHandler,
    @inject(S3_CLIENT_CONFIG) private readonly clientConfig: S3ClientConfig,
    @inject(S3_BUCKET) private readonly bucket: string
  ) {
    this.s3Client = new S3Client(clientConfig);
    this.shutdownHandler.addFunction(this.s3Client.destroy.bind(this));
  }

  public async set(key: string, body: Buffer, acl?: ObjectCannedACL | string): Promise<void> {
    try {
      const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ACL: acl });
      await this.s3Client.send(command);
    } catch (error) {
      const s3Error = error as Error;
      throw new S3Error(`an error occurred during the put of key ${key} on bucket ${this.bucket}, ${s3Error.message}`);
    }
  }
}
