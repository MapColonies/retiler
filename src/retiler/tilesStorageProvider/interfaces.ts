import { S3ClientConfig } from '@aws-sdk/client-s3';

type StorageProviderKind = 's3' | 'fs';

export interface TileStoragLayout {
  format: string;
  shouldFlipY: boolean;
}

export type StorageProviderConfig = S3StorageProviderConfig | FsStorageProviderConfig;

export interface S3StorageProviderConfig extends S3ClientConfig {
  kind: StorageProviderKind;
  endpoint: string;
  bucketName: string;
}

export interface FsStorageProviderConfig {
  kind: StorageProviderKind;
  basePath: string;
}
