import { Logger } from '@map-colonies/js-logger';
import { FactoryFunction } from 'tsyringe';
import { JOB_QUEUE_PROVIDER, SERVICES } from './common/constants';
import { timerify } from './common/util';
import { JobQueueProvider } from './retiler/interfaces';
import { TileProcessor } from './retiler/tileProcessor';
import { TileWithMetadata } from './retiler/types';

export const consumeAndProcessFactory: FactoryFunction<() => Promise<void>> = (container) => {
  const consumeAndProcess = async (): Promise<void> => {
    const processor = container.resolve(TileProcessor);
    const queueProv = container.resolve<JobQueueProvider>(JOB_QUEUE_PROVIDER);
    const logger = container.resolve<Logger>(SERVICES.LOGGER);

    await queueProv.consumeQueue<TileWithMetadata>(async (tile, jobId) => {
      const { parent, ...baseTile } = tile;

      logger.info({ msg: 'started processing tile', jobId, tile: baseTile, parent });

      const [, duration] = await timerify(processor.processTile.bind(processor), tile);

      logger.info({ msg: 'processing tile completed successfully', jobId, duration, tile: baseTile, parent });
    });
  };

  return consumeAndProcess;
};
