import { Readable,  } from 'stream';
import { Tile } from '@map-colonies/tile-calc';
import sharp from 'sharp';
import { DEFAULT_TILE_SIZE } from '../../common/constants';
import { MapSplitterProvider } from '../interfaces';
import { TileWithBuffer } from '../types';

// see https://sharp.pixelplumbing.com/api-utility for more global sharp properties that can affect performance (concurrency, cache)
// add implementation to these properties if needed
export class SharpMapSplitter implements MapSplitterProvider {
  public async splitMap(tile: Tile, stream: Readable): Promise<TileWithBuffer[]> {
    const metatile = tile.metatile ?? 1;
    const pipeline = sharp();
    stream.pipe(pipeline);
    const promises: Promise<Buffer>[] = [];
    const tiles: Tile[] = [];

    // TODO: consider adding a hard limit to the number of listeners
    pipeline.setMaxListeners(metatile * metatile + 1 + 1); // needs to be set to the number of clones or else a possible memory leak warning will be emmited

    for (let i = 0; i < metatile; i++) {
      for (let j = 0; j < metatile; j++) {
        promises.push(
          pipeline
            .clone()
            .extract({ left: j * DEFAULT_TILE_SIZE, top: i * DEFAULT_TILE_SIZE, width: DEFAULT_TILE_SIZE, height: DEFAULT_TILE_SIZE })
            .toBuffer({ resolveWithObject: false })
        );

        tiles.push({ z: tile.z, x: tile.x * metatile + j, y: tile.y * metatile + i, metatile: 1 });
      }
    }
    
    const buffers = await Promise.all(promises);
    return buffers.map((buffer, index) => ({ ...tiles[index], buffer }));
  }
}
