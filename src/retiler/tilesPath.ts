import { Tile } from '@map-colonies/tile-calc';

/**
 * @enum Tile layouts
 */
export enum TilesLayout {
  XYZ = 'XYZ',
  YXZ = 'YXZ',
  ZXY = 'ZXY',
  ZYX = 'ZYX',
}

/**
 * Generates a tile layout path
 * @param tile
 * @param tilesLayout a tile layout
 * @param prefixPath a path to prepend to the tiles path (e.g. /maps/world)
 * @param suffixPath a path to append to the tiles path (e.g. @2x or tile@2x)
 * @param format an image format
 * @returns tile layout path
 */
export const tileToLayout = (tile: Tile, tilesLayout?: TilesLayout, prefixPath = '', suffixPath = '', format = ''): string => {
  let tilePathLayout: string;

  switch (tilesLayout) {
    case TilesLayout.XYZ:
      tilePathLayout = `/${tile.x}/${tile.y}/${tile.z}`;
      break;
    case TilesLayout.YXZ:
      tilePathLayout = `/${tile.y}/${tile.x}/${tile.z}`;
      break;
    case TilesLayout.ZYX:
      tilePathLayout = `/${tile.z}/${tile.y}/${tile.x}`;
      break;
    case TilesLayout.ZXY:
      tilePathLayout = `/${tile.z}/${tile.x}/${tile.y}`;
      break;
    default:
      tilePathLayout = `/${tile.z}/${tile.x}/${tile.y}`; // same as ZXY
  }

  return `${prefixPath}${tilePathLayout}${suffixPath}.${format}`;
};
