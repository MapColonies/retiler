import type { Logger } from '@map-colonies/js-logger';
import type { FactoryFunction } from 'tsyringe';
import { JOB_QUEUE_PROVIDER, METATILE_PROCESSOR, SERVICES } from './common/constants';
import { timerify } from './common/util';
import type { JobQueueProvider, MetatileProcessor } from './retiler/interfaces';
import type { TileWithMetadata } from './retiler/types';
import type { ConfigType } from './common/config';

export const consumeAndProcessFactory: FactoryFunction<() => Promise<void>> = (container) => {
  const processor = container.resolve<MetatileProcessor>(METATILE_PROCESSOR);
  const queueProv = container.resolve<JobQueueProvider>(JOB_QUEUE_PROVIDER);
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);
  const parallelism = config.get('app.parallelism');

  const consumeAndProcess = async (): Promise<void> => {
    await queueProv.consumeQueue<TileWithMetadata>(async (tile, jobId) => {
      const { parent, ...baseTile } = tile;

      logger.info({ msg: 'started processing tile', jobId, tile: baseTile, parent, parallelism });

      const [, duration] = await timerify(processor.processTile.bind(processor), tile);

      logger.info({ msg: 'processing tile completed successfully', jobId, duration, tile: baseTile, parent, parallelism });
    }, parallelism);
  };

  return consumeAndProcess;
};
