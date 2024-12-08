/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import config from 'config';
import { S3StorageProviderConfig, StorageProviderConfig } from '../../../src/retiler/tilesStorageProvider/interfaces';

process.env.ALLOW_CONFIG_MUTATIONS = 'true'; // @aws-sdk/client-s3 attempts to modify config on tests

export default async (): Promise<void> => {
  const storageProvidersConfig = config.get<StorageProviderConfig[]>('app.tilesStorage.providers');

  const promises = storageProvidersConfig.map(async (provider) => {
    if (provider.kind !== 's3') {
      return Promise.resolve();
    }

    const { kind, bucketName, ...clientConfig } = provider as S3StorageProviderConfig;
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
  });

  await Promise.all(promises);
};
