import { vectorRetilerV1Type } from '@map-colonies/schemas';

export interface TileStoragLayout {
  format: string;
  shouldFlipY: boolean;
}

export type StorageProviderConfig = vectorRetilerV1Type['app']['tilesStorage']['providers'][number];
