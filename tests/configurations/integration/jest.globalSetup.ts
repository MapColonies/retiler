/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { S3Client, S3ClientConfig, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import config from 'config';

export default async (): Promise<void> => {
  const s3Config = config.get<S3ClientConfig>('app.tilesStorage.s3ClientConfig');
  const bucketName = config.get<string>('app.tilesStorage.s3Bucket');

  const s3Client = new S3Client(s3Config);

  try {
    const command = new HeadBucketCommand({ Bucket: bucketName });
    await s3Client.send(command);
  } catch (error) {
    const s3Error = error as Error;
    if (s3Error.name === 'NotFound') {
      const command = new CreateBucketCommand({ Bucket: bucketName });
      await s3Client.send(command);
    }
  }
};
