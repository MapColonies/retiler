/* eslint-disable import/first */
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { createServer } from 'node:http';
import { collectDefaultMetrics, register } from 'prom-client';
import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { CONSUME_AND_PROCESS_FACTORY, ExitCodes, LIVENESS_PROBE_FACTORY, SERVICES } from './common/constants';
import { ShutdownHandler } from './common/shutdownHandler';
import { registerExternalValues } from './containerConfig';
import { IConfig } from './common/interfaces';

let depContainer: DependencyContainer | undefined;

void registerExternalValues()
  .then(async (container) => {
    depContainer = container;
    const config = container.resolve<IConfig>(SERVICES.CONFIG);
    container.resolve<void>(LIVENESS_PROBE_FACTORY);
    register.setDefaultLabels({ project: config.get<string>('app.projectName') });
    collectDefaultMetrics();
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const server = createServer(async function (req, res) {
      // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-magic-numbers
      res.writeHead(200, { 'Content-Type': register.contentType });
      res.write(await register.metrics());
      res.end();
    });

    server.listen(config.get('telemetry.metrics.port'));

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
