import { Tile, validateTile, TILEGRID_WORLD_CRS84, SCALE_FACTOR } from '@map-colonies/tile-calc';

export const isTileInBounds = (tile: Tile): boolean => {
  try {
    validateTile(tile, TILEGRID_WORLD_CRS84);
    return true;
  } catch (err) {
    return false;
  }
};

export const getFlippedY = (tile: Tile): number => {
  return (TILEGRID_WORLD_CRS84.numberOfMinLevelTilesY / (tile.metatile ?? 1)) * SCALE_FACTOR ** tile.z - tile.y - 1;
};
