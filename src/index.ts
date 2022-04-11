/* eslint-disable import/first */
// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import http from 'http';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import config from 'config';
import { DependencyContainer } from 'tsyringe';
import { DEFAULT_SERVER_PORT, JOB_QUEUE_PROVIDER, SERVICES } from './common/constants';
import { ErrorWithExitCode } from './common/errors';
import { ShutdownHandler } from './common/shutdownHandler';
import { registerExternalValues } from './containerConfig';
import { JobQueueProvider } from './retiler/interfaces';
import { TileProcessor } from './retiler/tileProcessor';
import { TileWithMetadata } from './retiler/types';
import { timerify } from './common/util';

let depContainer: DependencyContainer | undefined;

interface IServerConfig {
  port: string;
}

const serverConfig = config.get<IServerConfig>('server');
const port: number = parseInt(serverConfig.port) || DEFAULT_SERVER_PORT;

void registerExternalValues()
  .then(async (container) => {
    depContainer = container;

    const shutdownHandler = container.resolve(ShutdownHandler);

    const stubHealthcheck = async (): Promise<void> => Promise.resolve();

    const server = http.createServer((request, response) => {
      response.end(`Hello World!\n\nThis is the Retiler server.\n\nThe server is running at http://localhost:${port}`);
    });

    server.on('close', () => {
      void shutdownHandler.shutdown();
      server.unref();
      process.exit();
    });

    createTerminus(server, {
      healthChecks: { '/liveness': stubHealthcheck },
      onSignal: shutdownHandler.shutdown.bind(shutdownHandler),
    });

    server.listen(port);

    const processor = container.resolve(TileProcessor);
    const queueProv = container.resolve<JobQueueProvider>(JOB_QUEUE_PROVIDER);
    const logger = container.resolve<Logger>(SERVICES.LOGGER);

    await queueProv.consumeQueue<TileWithMetadata>(async (tile, jobId) => {
      logger.info({ msg: 'processing job', jobId });

      const [, duration] = await timerify(processor.processTile.bind(processor), tile);

      logger.info({ msg: 'processing job completed successfully', jobId, duration });
    });

    server.close();
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
