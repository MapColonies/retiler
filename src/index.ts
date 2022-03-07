/* eslint-disable import/first */
// this import must be called before the first import of tsyring
import { createServer } from 'http';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import { get } from 'config';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { getApp } from './app';
import { DEFAULT_SERVER_PORT, JOBS_QUEUE_PROVIDER, QUEUE_NAME, SERVICES } from './common/constants';
import { ErrorWithExitCode } from './common/errors';
import { ShutdownHandler } from './common/shutdownHandler';
import { JobsQueueProvider } from './retiler/interfaces';
import { Retiler } from './retiler/retiler';

interface IServerConfig {
  port: string;
}

const serverConfig = get<IServerConfig>('server');
const port: number = parseInt(serverConfig.port) || DEFAULT_SERVER_PORT;

void getApp()
  .then(async (app) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    // TODO: handle liveness checks
    const stubHealthcheck = async (): Promise<void> => Promise.resolve();
    const shutdownHandler = container.resolve(ShutdownHandler);
    const server = createTerminus(createServer(app), {
      healthChecks: { '/liveness': stubHealthcheck },
      onSignal: shutdownHandler.shutdown.bind(shutdownHandler),
    });

    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    });

    const queueName = container.resolve<string>(QUEUE_NAME);

    const tiler = container.resolve(Retiler);
    const JobsQueueProvider: JobsQueueProvider = container.resolve(JOBS_QUEUE_PROVIDER);

    const startTime = performance.now();
    let counter = 0;
    while (!(await JobsQueueProvider.isEmpty())) {
      await tiler.proccessRequest();
      counter++;

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      if (counter % 1000) {
        logger.info(`processed ${counter} jobs in queue '${queueName}'`);
      }
    }

    const endTime = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    logger.info(`queue '${queueName}' was consumed and proccessed ${counter} metatiles in ${Math.round((endTime - startTime) / 1000)}s`);

    // queue is empty, stop the server
    server.on('close', () => {
      void shutdownHandler.shutdown();
      server.unref();
      process.exit();
    });

    server.close();
  })
  .catch(async (error: ErrorWithExitCode) => {
    if (container.isRegistered(SERVICES.LOGGER)) {
      const logger = container.resolve<Logger>(SERVICES.LOGGER);
      logger.error('😢 - failed initializing the server');
      logger.error(error);
    } else {
      console.error('😢 - failed initializing the server');
      console.error(error);
    }

    if (container.isRegistered(ShutdownHandler)) {
      const shutdownHandler = container.resolve(ShutdownHandler);
      await shutdownHandler.shutdown();
    }

    // TODO: add more exit codes
    process.exit(error.exitCode);
  });
