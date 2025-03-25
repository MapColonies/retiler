import { Tile } from '@map-colonies/tile-calc';

export interface TileMetadata {
  parent: string;
  state?: number;
  force?: boolean;
  isBlank?: boolean;
}

export type TileWithMetadata = Required<Tile> & Partial<TileMetadata>;

export type TileWithBuffer = TileWithMetadata & { buffer: Buffer };

export type MapProviderType = 'wms' | 'arcgis';

export type WmsVersion = '1.1.1' | '1.3.0';
