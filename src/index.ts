/* eslint-disable import/first */
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { JOB_QUEUE_PROVIDER, SERVICES } from './common/constants';
import { ErrorWithExitCode } from './common/errors';
import { ShutdownHandler } from './common/shutdownHandler';
import { registerExternalValues } from './containerConfig';
import { JobQueueProvider } from './retiler/interfaces';
import { TileProcessor } from './retiler/tileProcessor';
import { TileWithMetadata } from './retiler/types';
import { timerify } from './common/util';
import { initLivenessProbe } from './common/liveness';

let depContainer: DependencyContainer | undefined;

void registerExternalValues()
  .then(async (container) => {
    depContainer = container;

    const livenessProbe = initLivenessProbe(container);

    const processor = container.resolve(TileProcessor);
    const queueProv = container.resolve<JobQueueProvider>(JOB_QUEUE_PROVIDER);
    const logger = container.resolve<Logger>(SERVICES.LOGGER);

    await queueProv.consumeQueue<TileWithMetadata>(async (tile, jobId) => {
      const { parent, ...baseTile } = tile;

      logger.info({ msg: 'started processing tile', jobId, tile: baseTile, parent });

      const [, duration] = await timerify(processor.processTile.bind(processor), tile);

      logger.info({ msg: 'processing tile completed successfully', jobId, duration, tile: baseTile, parent });
    });

    livenessProbe.close();
  })
  .catch(async (error: ErrorWithExitCode) => {
    const errorLogger = depContainer?.isRegistered(SERVICES.LOGGER) === true ? depContainer.resolve<Logger>(SERVICES.LOGGER).error : console.error;
    errorLogger('an unexpected error occurred', error);

    if (depContainer?.isRegistered(ShutdownHandler) === true) {
      const shutdownHandler = depContainer.resolve(ShutdownHandler);
      await shutdownHandler.shutdown();
    }

    process.exit(error.exitCode);
  });
