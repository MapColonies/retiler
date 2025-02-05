import config from 'config';
import { rimraf } from 'rimraf';
import { FsStorageProviderConfig, StorageProviderConfig } from '../../../src/retiler/tilesStorageProvider/interfaces';

export default async function (): Promise<void> {
  const tileProviders = config.get<StorageProviderConfig[]>('app.tilesStorage.providers');

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const tileProvider = tileProviders.find(({ kind }) => kind === 'fs') as FsStorageProviderConfig | undefined;
  if (!tileProvider) {
    return;
  }
  await rimraf(tileProvider.basePath);
}
