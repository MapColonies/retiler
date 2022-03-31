/* eslint-disable import/first */
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import http from 'http';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import { get } from 'config';
import { DependencyContainer } from 'tsyringe';
import { DEFAULT_SERVER_PORT, JOB_QUEUE_PROVIDER, QUEUE_NAME, SERVICES } from './common/constants';
import { ErrorWithExitCode } from './common/errors';
import { ShutdownHandler } from './common/shutdownHandler';
import { JobQueueProvider } from './retiler/interfaces';
import { TileProcessor } from './retiler/tileProcessor';
import { registerExternalValues } from './containerConfig';

interface IServerConfig {
  port: string;
}

const serverConfig = get<IServerConfig>('server');
const port: number = parseInt(serverConfig.port) || DEFAULT_SERVER_PORT;

let depContainer: DependencyContainer | undefined = undefined;

void registerExternalValues()
  .then(async (container) => {
    depContainer = container;
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    // TODO: handle liveness checks
    const stubHealthcheck = async (): Promise<void> => Promise.resolve();
    const shutdownHandler = container.resolve(ShutdownHandler);

    const server = http.createServer((request, response) => {
      response.end(`Hello World!\n\nThis is the Retiler server.\n\nThe server is running at http://localhost:${port}`);
    });

    createTerminus(server, {
      healthChecks: { '/liveness': stubHealthcheck },
      onSignal: shutdownHandler.shutdown.bind(shutdownHandler),
    });

    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    });

    const queueName = container.resolve<string>(QUEUE_NAME);

    const processor = container.resolve(TileProcessor);
    const JobsQueueProvider: JobQueueProvider = container.resolve(JOB_QUEUE_PROVIDER);

    logger.info(`processing queue '${queueName}'`);

    const startTime = performance.now();
    let counter = 0;
    while (!(await JobsQueueProvider.isEmpty())) {
      await processor.proccessRequest();
      counter++;
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      if (counter % 1000 === 0) {
        logger.info(`processed ${counter} jobs in queue '${queueName}'`);
      }
    }

    const endTime = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    logger.info(`queue '${queueName}' was consumed and proccessed ${counter} metatiles in ${((endTime - startTime) / 1000).toFixed(2)}s`);

    // queue is empty, stop the server
    server.on('close', () => {
      void shutdownHandler.shutdown();
      server.unref();
      process.exit();
    });

    server.close();
  })
  .catch(async (error: ErrorWithExitCode) => {
    const errorLogger = depContainer?.isRegistered(SERVICES.LOGGER) === true ? depContainer.resolve<Logger>(SERVICES.LOGGER).error : console.error;
    errorLogger('an unexpected error occurred', error);

    if (depContainer?.isRegistered(SERVICES.LOGGER) === true) {
      const shutdownHandler = depContainer.resolve(ShutdownHandler);
      await shutdownHandler.shutdown();
    }

    process.exit(error.exitCode);
  });
