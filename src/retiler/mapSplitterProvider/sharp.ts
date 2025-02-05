import sharp from 'sharp';
import { inject, injectable } from 'tsyringe';
import { type Logger } from '@map-colonies/js-logger';
import { Tile } from '@map-colonies/tile-calc';
import { SERVICES, TILE_SIZE } from '../../common/constants';
import { MapSplitterProvider } from '../interfaces';
import { TileWithBuffer } from '../types';
import { isTileInBounds } from '../util';
import { timerify } from '../../common/util';

@injectable()
export class SharpMapSplitter implements MapSplitterProvider {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  public async splitMap(tile: TileWithBuffer): Promise<TileWithBuffer[]> {
    const { buffer, parent, ...baseTile } = tile;
    this.logger.debug({ msg: 'splitting tile', tile: baseTile, parent });

    const promises: Promise<Buffer>[] = [];
    const tiles: Required<Tile>[] = [];

    const pipeline = sharp(buffer);
    const splitsPerAxis = tile.metatile;
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

    const [buffers, duration] = await timerify(async () => Promise.all(promises));

    this.logger.debug({ msg: 'finished splitting tile', tile: baseTile, duration, parent });

    return buffers.map((buffer, index) => ({ ...tiles[index], buffer, parent }));
  }
}
