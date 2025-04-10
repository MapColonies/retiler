import { type vectorRetilerV1Type } from '@map-colonies/schemas';

export type TileStoragLayout = vectorRetilerV1Type['app']['tilesStorage']['layout'];

export type StorageProviderConfig = vectorRetilerV1Type['app']['tilesStorage']['providers'][number];

export type FsStorageProviderConfig = Extract<StorageProviderConfig, { kind: 'fs' }>;
