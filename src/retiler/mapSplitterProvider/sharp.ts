import sharp from 'sharp';
import { inject, injectable } from 'tsyringe';
import { type Logger } from '@map-colonies/js-logger';
import { Tile } from '@map-colonies/tile-calc';
import { SERVICES, SHOULD_FILTER_BLANK_TILES, TILE_SIZE } from '../../common/constants';
import { MapSplitterProvider } from '../interfaces';
import { TileWithBuffer } from '../types';
import { isTileInBounds } from '../util';
import { timerify } from '../../common/util';

const isBlankTile = async (tileBuffer: Promise<Buffer>): Promise<boolean> => {
  // `stats()` works solely on the source image and not on the result of any operations done on it
  const { channels } = await sharp(await tileBuffer).stats();

  for (const channel of channels) {
    if (channel.max !== 0) {
      return false;
    }
  }

  return true;
};

const unitePromises = async (buffer: Promise<Buffer>, blank: Promise<boolean>): Promise<{ buffer: Buffer; isBlankTile: boolean }> => {
  const [bufferRes, isBlankTile] = await Promise.all([buffer, blank]);
  return { buffer: bufferRes, isBlankTile };
};

@injectable()
export class SharpMapSplitter implements MapSplitterProvider {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SHOULD_FILTER_BLANK_TILES) private readonly shouldFilterBlankTiles: boolean
  ) {}

  public async splitMap(tile: TileWithBuffer): Promise<TileWithBuffer[]> {
    const { buffer, parent, ...baseTile } = tile;
    this.logger.debug({ msg: 'splitting tile', tile: baseTile, parent });

    const promises: Promise<{ buffer: Buffer; isBlankTile: boolean }>[] = [];
    const tiles: Required<Tile>[] = [];

    const pipeline = sharp(buffer);
    const splitsPerAxis = tile.metatile;
    pipeline.setMaxListeners(splitsPerAxis * splitsPerAxis + 1 + 1);

    for (let row = 0; row < splitsPerAxis; row++) {
      for (let column = 0; column < splitsPerAxis; column++) {
        const subTile: Required<Tile> = { z: tile.z, x: tile.x * splitsPerAxis + column, y: tile.y * splitsPerAxis + row, metatile: 1 };

        if (isTileInBounds(subTile)) {
          const extractedSubTile = pipeline.clone().extract({ left: column * TILE_SIZE, top: row * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE });

          const extractedSubTileBuffer = extractedSubTile.toBuffer({ resolveWithObject: false });

          promises.push(
            unitePromises(extractedSubTileBuffer, this.shouldFilterBlankTiles ? isBlankTile(extractedSubTileBuffer) : Promise.resolve(false))
          );

          tiles.push(subTile);
        }
      }
    }

    const [buffers, duration] = await timerify(async () => Promise.all(promises));

    this.logger.debug({ msg: 'finished splitting tile', tile: baseTile, duration, parent });

    const mappedBuffers = buffers.map((buffer, index) => ({ ...tiles[index], ...buffer, parent }));

    if (this.shouldFilterBlankTiles) {
      const filtered = mappedBuffers.filter((tile) => !tile.isBlankTile);
      return filtered;
    }
    return mappedBuffers;
  }
}
