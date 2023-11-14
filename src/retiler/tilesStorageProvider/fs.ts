import { join, dirname } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger } from '@map-colonies/js-logger';
import { Tile } from '@map-colonies/tile-calc';
import Format from 'string-format';
import { timerify } from '../../common/util';
import { TilesStorageProvider } from '../interfaces';
import { TileWithBuffer } from '../types';
import { getFlippedY } from '../util';
import { TileStoragLayout } from './interfaces';

export class FsTilesStorage implements TilesStorageProvider {
  public constructor(private readonly logger: Logger, private readonly baseStoragePath: string, private readonly storageLayout: TileStoragLayout) {
    this.logger.info({ msg: 'initializing FS tile storage', baseStoragePath: this.baseStoragePath, storageLayout });
  }

  public async storeTile(tileWithBuffer: TileWithBuffer): Promise<void> {
    const { buffer, parent, ...baseTile } = tileWithBuffer;

    const key = this.determineKey(baseTile);

    this.logger.debug({ msg: 'storing tile in fs', tile: baseTile, parent, baseStoragePath: this.baseStoragePath, key });

    const storagePath = join(this.baseStoragePath, key);

    try {
      const dir = dirname(storagePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(storagePath, buffer);
    } catch (error) {
      const fsError = error as Error;
      this.logger.error({
        msg: 'an error occurred during tile storing',
        err: fsError,
        baseStoragePath: this.baseStoragePath,
        tile: baseTile,
        parent,
        key,
      });
      console.log(error);
      throw new Error(`an error occurred during the write of key ${key}, ${fsError.message}`);
    }
  }

  public async storeTiles(tiles: TileWithBuffer[]): Promise<void> {
    const parent = tiles[0].parent;

    this.logger.debug({ msg: 'storing batch of tiles in fs', baseStoragePath: this.baseStoragePath, parent, count: tiles.length });

    const [, duration] = await timerify(async () => Promise.all(tiles.map(async (tile) => this.storeTile(tile))));

    this.logger.debug({ msg: 'finished storing batch of tiles', duration, baseStoragePath: this.baseStoragePath, parent, count: tiles.length });
  }

  private determineKey(tile: Required<Tile>): string {
    if (this.storageLayout.shouldFlipY) {
      tile.y = getFlippedY(tile);
    }
    const key = Format(this.storageLayout.format, tile);
    return key;
  }
}
