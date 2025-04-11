/* eslint-disable @typescript-eslint/naming-convention */ // s3-client object commands arguments
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { serializeError } from '@common.js/serialize-error';
import { getConfig, initConfig } from '../../../src/common/config';

process.env.ALLOW_CONFIG_MUTATIONS = 'true'; // @aws-sdk/client-s3 attempts to modify config on tests

export default async (): Promise<void> => {
  await initConfig(true);
  const config = getConfig();

  const storageProvidersConfig = config.get('app.tilesStorage.providers');

  const promises = storageProvidersConfig.map(async (provider) => {
    if (provider.kind !== 's3') {
      return Promise.resolve();
    }

    const { kind, bucketName, ...clientConfig } = provider;
    const s3Client = new S3Client(structuredClone(clientConfig));

    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    } catch (error) {
      const s3Error = error as Error;
      if (s3Error.name !== 'NotFound') {
        console.log(serializeError(error));
        throw s3Error;
      }
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
    }
  });

  await Promise.all(promises);
};
