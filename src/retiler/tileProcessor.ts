import { Logger } from '@map-colonies/js-logger';
import { Tile } from '@map-colonies/tile-calc';
import { inject, injectable } from 'tsyringe';
import { MAP_PROVIDER, MAP_SPLITTER_PROVIDER, SERVICES, TILES_STORAGE_PROVIDER } from '../common/constants';
import { timerify } from '../common/util';
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
    this.logger.debug({ msg: 'starting to process', tile });

    const [mapBuffer, getMapDuration] = await timerify(this.mapProvider.getMap.bind(this.mapProvider), tile);

    this.logger.debug({ msg: 'finished getting map', tile, duration: getMapDuration });

    const [tiles, splitMapDuration] = await timerify(this.mapSplitter.splitMap.bind(this.mapSplitter), tile, mapBuffer);

    this.logger.debug({ msg: 'finished splitting tile', tile, duration: splitMapDuration });

    const [, storeTilesDuration] = await timerify(this.tilesStorageProvider.storeTiles.bind(this.tilesStorageProvider), tiles);

    this.logger.debug({ msg: 'finished storing tiles', tile, duration: storeTilesDuration });
  }
}
