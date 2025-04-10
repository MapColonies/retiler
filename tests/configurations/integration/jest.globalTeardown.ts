import { rimraf } from 'rimraf';
import { FsStorageProviderConfig } from '../../../src/retiler/tilesStorageProvider/interfaces';
import { getConfig } from '../../../src/common/config';

export default async function (): Promise<void> {
  const config = getConfig();
  const tileProviders = config.get('app.tilesStorage.providers');

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const tileProvider = tileProviders.find(({ kind }) => kind === 'fs') as FsStorageProviderConfig | undefined;
  if (!tileProvider) {
    return;
  }
  await rimraf(tileProvider.basePath);
}
