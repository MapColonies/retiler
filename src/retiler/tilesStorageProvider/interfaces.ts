import { type VectorRetilerSchemaType } from '../../common/config';

export interface TileStoragLayout {
  format: string;
  shouldFlipY: boolean;
}

export type TilesStorageConfig = NonNullable<VectorRetilerSchemaType['app']['tilesStorage']>;

export type StorageProviderConfig = TilesStorageConfig['providers'][number];
