/* eslint-disable import/first */
if (process.env.DEBUG_BINARY === 'true') {
  const segfaultHandler = require('segfault-handler');

  segfaultHandler.registerHandler('crash.log');
}
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { CONSUME_AND_PROCESS_FACTORY, ExitCodes, LIVENESS_PROBE_FACTORY, SERVICES } from './common/constants';
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
  .catch(async (error: Error) => {
    const errorLogger =
      depContainer?.isRegistered(SERVICES.LOGGER) == true
        ? depContainer.resolve<Logger>(SERVICES.LOGGER).error.bind(depContainer.resolve<Logger>(SERVICES.LOGGER))
        : console.error;
    errorLogger({ msg: 'an unexpected error occurred', err: error });

    if (depContainer?.isRegistered(ShutdownHandler) === true) {
      const shutdownHandler = depContainer.resolve(ShutdownHandler);
      await shutdownHandler.shutdown();
    }

    process.exit(ExitCodes.GENERAL_ERROR);
  });
