/* eslint-disable import/first */
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { createServer } from 'http';
import express from 'express';
import { type Logger } from '@map-colonies/js-logger';
import { createTerminus } from '@godaddy/terminus';
import { DependencyContainer } from 'tsyringe';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { CONSUME_AND_PROCESS_FACTORY, DEFAULT_PORT, ExitCodes, ON_SIGNAL, SERVICES } from './common/constants';
import { registerExternalValues } from './containerConfig';
import { IConfig, IServerConfig } from './common/interfaces';

let depContainer: DependencyContainer | undefined;

void registerExternalValues()
  .then(async (container) => {
    depContainer = container;

    const config = container.resolve<IConfig>(SERVICES.CONFIG);
    const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
    // const registry = container.resolve<Registry>(METRICS_REGISTRY);

    const app = express();

    // app.use('/metrics', metricsMiddleware(registry));
    const stubHealthCheck = async (): Promise<void> => Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-misused-promises
    const server = createTerminus(createServer(app), { healthChecks: { '/liveness': stubHealthCheck }, onSignal: container.resolve('onSignal') });

    cleanupRegistry.register({
      func: async () => {
        return new Promise((resolve) => {
          server.once('close', resolve);
          server.close();
        });
      },
    });

    const serverConfig = config.get<IServerConfig>('server');
    const port: number = parseInt(serverConfig.port) || DEFAULT_PORT;

    server.listen(port, () => {
      const logger = container.resolve<Logger>(SERVICES.LOGGER);
      logger.debug(`liveness on port ${port}`);
    });

    const consumeAndProcess = container.resolve<() => Promise<void>>(CONSUME_AND_PROCESS_FACTORY);
    await consumeAndProcess();
  })
  .catch(async (error: Error) => {
    const errorLogger =
      depContainer?.isRegistered(SERVICES.LOGGER) == true
        ? depContainer.resolve<Logger>(SERVICES.LOGGER).error.bind(depContainer.resolve<Logger>(SERVICES.LOGGER))
        : console.error;
    errorLogger({ msg: 'an unexpected error occurred', err: error });

    if (depContainer?.isRegistered(ON_SIGNAL) === true) {
      const shutDown: () => Promise<void> = depContainer.resolve(ON_SIGNAL);
      await shutDown();
    }

    process.exit(ExitCodes.GENERAL_ERROR);
  });
