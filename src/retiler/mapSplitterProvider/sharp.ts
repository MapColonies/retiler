import { Tile } from '@map-colonies/tile-calc';
import sharp from 'sharp';
import { TILE_SIZE } from '../../common/constants';
import { MapSplitterProvider } from '../interfaces';
import { TileWithBuffer } from '../types';
import { isTileInBounds } from '../util';

export class SharpMapSplitter implements MapSplitterProvider {
  public async splitMap(tile: Tile, buffer: Buffer): Promise<TileWithBuffer[]> {
    const promises: Promise<Buffer>[] = [];
    const tiles: Tile[] = [];

    const pipeline = sharp(buffer);
    const splitsPerAxis = tile.metatile ?? 1;
    pipeline.setMaxListeners(splitsPerAxis * splitsPerAxis + 1 + 1);

    for (let row = 0; row < splitsPerAxis; row++) {
      for (let column = 0; column < splitsPerAxis; column++) {
        const subTile = { z: tile.z, x: tile.x * splitsPerAxis + column, y: tile.y * splitsPerAxis + row, metatile: 1 };

        if (isTileInBounds(subTile)) {
          promises.push(
            pipeline
              .clone()
              .extract({ left: column * TILE_SIZE, top: row * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE })
              .toBuffer({ resolveWithObject: false })
          );

          tiles.push(subTile);
        }
      }
    }

    const buffers = await Promise.all(promises);
    return buffers.map((buffer, index) => ({ ...tiles[index], buffer }));
  }
}
