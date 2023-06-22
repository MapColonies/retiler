/* eslint-disable import/first */
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { createServer } from 'node:http';
import express from 'express';
import { Registry } from 'prom-client';
import { metricsMiddleware } from '@map-colonies/telemetry';
import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { CONSUME_AND_PROCESS_FACTORY, DEFAULT_PORT, ExitCodes, LIVENESS_PROBE_FACTORY, METRICS_REGISTRY, SERVICES } from './common/constants';
import { ShutdownHandler } from './common/shutdownHandler';
import { registerExternalValues } from './containerConfig';
import { IConfig, IServerConfig } from './common/interfaces';
import { LivenessFactory } from './common/liveness';

let depContainer: DependencyContainer | undefined;

void registerExternalValues()
  .then(async (container) => {
    depContainer = container;
    const config = container.resolve<IConfig>(SERVICES.CONFIG);
    const shutdownHandler = container.resolve(ShutdownHandler);
    const livenessFactory = container.resolve<LivenessFactory>(LIVENESS_PROBE_FACTORY);
    const registry = container.resolve<Registry>(METRICS_REGISTRY);

    const app = express();

    app.use('/metrics', metricsMiddleware(registry));

    const server = livenessFactory(createServer(app));

    shutdownHandler.addFunction(async () => {
      return new Promise((resolve) => {
        server.once('close', resolve);
        server.close();
      });
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

    if (depContainer?.isRegistered(ShutdownHandler) === true) {
      const shutdownHandler = depContainer.resolve(ShutdownHandler);
      await shutdownHandler.shutdown();
    }

    process.exit(ExitCodes.GENERAL_ERROR);
  });
