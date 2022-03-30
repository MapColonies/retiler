import { Tile, TILEGRID_WORLD_CRS84, SCALE_FACTOR } from '@map-colonies/tile-calc';

export const isTileOutOfBounds = (tile: Tile): boolean => {
  return (
    tile.x >= (TILEGRID_WORLD_CRS84.numberOfMinLevelTilesX / (tile.metatile ?? 1)) * SCALE_FACTOR ** tile.z ||
    tile.y >= (TILEGRID_WORLD_CRS84.numberOfMinLevelTilesY / (tile.metatile ?? 1)) * SCALE_FACTOR ** tile.z
  );
};

export const getReversedY = (tile: Tile): number => {
  return (TILEGRID_WORLD_CRS84.numberOfMinLevelTilesY / (tile.metatile ?? 1)) * SCALE_FACTOR ** tile.z - tile.y - 1;
};
