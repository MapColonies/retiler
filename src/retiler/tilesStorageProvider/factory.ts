import { S3Client } from '@aws-sdk/client-s3';
import { type Logger } from '@map-colonies/js-logger';
import { FactoryFunction } from 'tsyringe';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { ConfigType } from '@src/common/config';
import { validate } from '../../common/validation';
import { SERVICES } from '../../common/constants';
import { TilesStorageProvider } from '../interfaces';
import { StorageProviderConfig } from './interfaces';
import { S3TilesStorage } from './s3';
import { FsTilesStorage } from './fs';
import { TILES_STORAGE_PROVIDERS_SCHEMA } from './validation';

export const tilesStorageProvidersFactory: FactoryFunction<TilesStorageProvider[]> = (container) => {
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
  const storageProvidersConfig = config.get('app.tilesStorage.providers');
  const tilesStorageLayout = config.get('app.tilesStorage.layout');

  const { isValid, errors } = validate<StorageProviderConfig[]>(storageProvidersConfig, TILES_STORAGE_PROVIDERS_SCHEMA);
  if (!isValid) {
    throw new Error(`invalid tiles storage providers configuration: ${JSON.stringify(errors)}`);
  }

  const s3ClientsMap = new Map<string, S3Client>();
  return storageProvidersConfig.map((providerConfig) => {
    if (providerConfig.kind === 's3') {
      const { kind, bucketName, ...clientConfig } = providerConfig;
      let s3Client = s3ClientsMap.get(clientConfig.endpoint);

      if (!s3Client) {
        s3Client = new S3Client(clientConfig);
        s3ClientsMap.set(clientConfig.endpoint, s3Client);

        cleanupRegistry.register({
          func: async () => {
            return new Promise((resolve) => {
              (s3Client as S3Client).destroy();
              return resolve(undefined);
            });
          },
          id: `s3-${clientConfig.endpoint}`,
        });
      }

      return new S3TilesStorage(s3Client, logger, bucketName, tilesStorageLayout);
    }

    const { basePath } = providerConfig;
    return new FsTilesStorage(logger, basePath, tilesStorageLayout);
  });
};
