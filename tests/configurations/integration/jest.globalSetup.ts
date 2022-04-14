/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { S3Client, S3ClientConfig, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import config from 'config';

export default async (): Promise<void> => {
  const s3Config = config.get<S3ClientConfig>('app.tilesStorage.s3ClientConfig');
  const bucketName = config.get<string>('app.tilesStorage.s3Bucket');

  const s3Client = new S3Client(s3Config);

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (error) {
    const s3Error = error as Error;
    if (s3Error.name !== 'NotFound') {
      throw s3Error;
    }
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }
};
