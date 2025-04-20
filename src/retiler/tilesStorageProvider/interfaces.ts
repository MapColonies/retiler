import { type vectorRetilerFullV1Type } from '@map-colonies/schemas';

export type TileStoragLayout = vectorRetilerFullV1Type['app']['tilesStorage']['layout'];

export type StorageProviderConfig = vectorRetilerFullV1Type['app']['tilesStorage']['providers'][number];

export type FsStorageProviderConfig = Extract<StorageProviderConfig, { kind: 'fs' }>;
