import { S3ClientConfig } from '@aws-sdk/client-s3';

type StorageProviderType = 's3' | 'fs';

export interface TileStoragLayout {
  format: string;
  shouldFlipY: boolean;
}

export type StorageProviderConfig = S3StorageProviderConfig | FsStorageProviderConfig;

export interface S3StorageProviderConfig extends S3ClientConfig {
  endpoint: string;
  type: StorageProviderType;
  bucketName: string;
}

export interface FsStorageProviderConfig {
  type: StorageProviderType;
  basePath: string;
}
