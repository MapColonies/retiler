import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { MAP_PROVIDER, MAP_SPLITTER_PROVIDER, SERVICES, TILES_STORAGE_PROVIDER } from '../common/constants';
import { MapProvider, MapSplitterProvider, TilesStorageProvider } from './interfaces';
import { TileWithMetadata } from './types';

@injectable()
export class TileProcessor {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @inject(MAP_SPLITTER_PROVIDER) private readonly mapSplitter: MapSplitterProvider,
    @inject(TILES_STORAGE_PROVIDER) private readonly tilesStorageProvider: TilesStorageProvider
  ) {}

  public async processTile(tile: TileWithMetadata): Promise<void> {
    const mapBuffer = await this.mapProvider.getMap(tile);

    const tiles = await this.mapSplitter.splitMap({ ...tile, buffer: mapBuffer });

    await this.tilesStorageProvider.storeTiles(tiles);
  }
}
