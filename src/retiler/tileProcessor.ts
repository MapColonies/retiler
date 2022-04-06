import { Logger } from '@map-colonies/js-logger';
import { Tile, tileToBoundingBox } from '@map-colonies/tile-calc';
import { inject, injectable } from 'tsyringe';
import { TILE_SIZE, MAP_PROVIDER, MAP_SPLITTER_PROVIDER, SERVICES, TILES_STORAGE_PROVIDER } from '../common/constants';
import { measurePromise, roundMs } from '../common/util';
import { MapProvider, MapSplitterProvider, TilesStorageProvider } from './interfaces';

@injectable()
export class TileProcessor {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @inject(MAP_SPLITTER_PROVIDER) private readonly mapSplitter: MapSplitterProvider,
    @inject(TILES_STORAGE_PROVIDER) private readonly tilesStorageProvider: TilesStorageProvider
  ) {}

  public async processTile(tile: Required<Tile>): Promise<void> {
    const tileDescription = `{ z: ${tile.z}, x: ${tile.x}, y: ${tile.y}, metatile: ${tile.metatile} }`;
    this.logger.debug(`processing tile ${tileDescription}`);

    const bbox = tileToBoundingBox(tile);
    const mapSizePerAxis = tile.metatile * TILE_SIZE;
    const getMapPromise = this.mapProvider.getMap(bbox, mapSizePerAxis, mapSizePerAxis);
    const [mapBuffer, getMapDuration] = await measurePromise(getMapPromise);

    this.logger.debug(`got map in ${roundMs(getMapDuration)}`);

    const splitMapPromise = this.mapSplitter.splitMap(tile, mapBuffer);
    const [tiles, splitMapDuration] = await measurePromise(splitMapPromise);

    this.logger.debug(`splitted map in ${roundMs(splitMapDuration)}`);

    this.logger.debug(`storing tiles, ${tiles.length} tiles to be stored`);

    const storeTilesPromise = Promise.all(tiles.map(async (tile) => this.tilesStorageProvider.storeTile(tile)));
    const [, storeTilesDuration] = await measurePromise(storeTilesPromise);

    this.logger.debug(`stored tiles in ${roundMs(storeTilesDuration)}`);
  }
}
