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
import { initLivenessProbe } from './common/liveness';

let depContainer: DependencyContainer | undefined;

void registerExternalValues()
  .then(async (container) => {
    depContainer = container;

    const livenessProbe = initLivenessProbe(container);

    const processor = container.resolve(TileProcessor);
    const queueProv = container.resolve<JobQueueProvider>(JOB_QUEUE_PROVIDER);
    await queueProv.consumeQueue(processor.processTile.bind(processor));

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
