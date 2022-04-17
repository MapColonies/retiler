/* eslint-disable import/first */
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { CONSUME_AND_PROCESS_FACTORY, LIVENESS_PROBE_FACTORY, SERVICES } from './common/constants';
import { ErrorWithExitCode } from './common/errors';
import { ShutdownHandler } from './common/shutdownHandler';
import { registerExternalValues } from './containerConfig';

let depContainer: DependencyContainer | undefined;

void registerExternalValues()
  .then(async (container) => {
    depContainer = container;

    container.resolve<void>(LIVENESS_PROBE_FACTORY);

    const consumeAndProcess = container.resolve<() => Promise<void>>(CONSUME_AND_PROCESS_FACTORY);
    await consumeAndProcess();

    const shutdownHandler = container.resolve(ShutdownHandler);
    await shutdownHandler.shutdown();
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
