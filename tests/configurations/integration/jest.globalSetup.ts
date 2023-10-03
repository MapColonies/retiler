/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import config from 'config';
import { S3StorageProviderConfig, StorageProviderConfig } from '../../../src/retiler/tilesStorageProvider/interfaces';

export default async (): Promise<void> => {
  const storageProvidersConfig = config.get<StorageProviderConfig[]>('app.tilesStorage.providers');
  for await (const provider of storageProvidersConfig) {
    if (provider.type !== 's3') {
      return;
    }

    console.log(provider)

    const { type, bucketName, ...clientConfig } = provider as S3StorageProviderConfig;
    const s3Client = new S3Client(clientConfig);

    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    } catch (error) {
      const s3Error = error as Error;
      if (s3Error.name !== 'NotFound') {
        throw s3Error;
      }
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
    }
  }
};
