import sharp from 'sharp';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { Tile } from '@map-colonies/tile-calc';
import { SERVICES, TILE_SIZE } from '../../common/constants';
import { MapSplitterProvider } from '../interfaces';
import { MapSplitResult, TileWithBuffer } from '../types';
import { isTileInBounds } from '../util';
import { timerify } from '../../common/util';

const isBlankTile = async (buffer: Buffer): Promise<boolean> => {
  const { channels } = await sharp(buffer).stats();
  return channels.every((c) => c.max === 0);
};

@injectable()
export class SharpMapSplitter implements MapSplitterProvider {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  public async splitMap(tile: TileWithBuffer, shouldFilterBlankTiles?: boolean): Promise<MapSplitResult> {
    const { buffer, parent, ...baseTile } = tile;

    const splitsPerAxis = tile.metatile;
    const splitsCount = splitsPerAxis * splitsPerAxis;

    if (shouldFilterBlankTiles === true) {
      const isBlank = await isBlankTile(buffer);
      if (isBlank) {
        this.logger.debug({ msg: 'filtering full metatile due to blank detection', tile: baseTile, parent });
        return { isMetatileBlank: true, splittedTiles: [], blankCount: splitsCount, outOfBoundsCount: 0 };
      }
    }

    this.logger.debug({ msg: 'splitting tile', tile: baseTile, parent, splitsPerAxis, splitsCount, shouldFilterBlankTiles });

    const promises: Promise<TileWithBuffer | undefined>[] = [];
    const result: MapSplitResult = { isMetatileBlank: false, blankCount: 0, outOfBoundsCount: 0, splittedTiles: [] };

    const pipeline = sharp(buffer);
    pipeline.setMaxListeners(splitsPerAxis * splitsPerAxis + 1 + 1);

    for (let row = 0; row < splitsPerAxis; row++) {
      for (let column = 0; column < splitsPerAxis; column++) {
        const subTile: Required<Tile> = { z: tile.z, x: tile.x * splitsPerAxis + column, y: tile.y * splitsPerAxis + row, metatile: 1 };

        if (!isTileInBounds(subTile)) {
          this.logger.debug({ msg: 'sub tile is out of bounds', tile: baseTile, parent });

          result.outOfBoundsCount++;
          continue;
        }

        promises.push(
          (async (): Promise<TileWithBuffer | undefined> => {
            const extractedSubTileBuffer = await pipeline
              .clone()
              .extract({ left: column * TILE_SIZE, top: row * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE })
              .toBuffer({ resolveWithObject: false });

            if (shouldFilterBlankTiles === true) {
              const isBlank = await isBlankTile(extractedSubTileBuffer);
              if (isBlank) {
                result.blankCount++;
                return;
              }
            }

            return { ...subTile, buffer: extractedSubTileBuffer, parent };
          })()
        );
      }
    }

    const [tilesWithBuffers, duration] = await timerify(async () => {
      const tileWithBuffer = await Promise.all(promises);
      return tileWithBuffer.filter((r) => r !== undefined);
    });

    this.logger.debug({
      msg: 'finished splitting tile',
      tile: baseTile,
      duration,
      parent,
      splitsCount,
      filteredCount: splitsCount - tilesWithBuffers.length,
    });

    return { ...result, splittedTiles: tilesWithBuffers as TileWithBuffer[] };
  }
}
