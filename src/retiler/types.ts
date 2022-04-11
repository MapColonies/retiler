import { Tile } from '@map-colonies/tile-calc';

export interface TileMetadata {
  parent: string;
}

export type TileWithMetadata = Required<Tile> & Partial<TileMetadata>;

export type TileWithBuffer = TileWithMetadata & { buffer: Buffer };
