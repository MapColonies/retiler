import { rimraf } from 'rimraf';
import { getConfig } from '../../../src/common/config';

export default async function (): Promise<void> {
  const config = getConfig();
  const tileProviders = config.get('app.tilesStorage.providers');

  for (const provider of tileProviders) {
    if (provider.kind === 's3') {
      continue;
    }
    await rimraf(provider.basePath);
  }
}
