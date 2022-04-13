import http from 'http';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { IConfig, IServerConfig } from './interfaces';
import { DEFAULT_SERVER_PORT, SERVICES } from './constants';
import { ShutdownHandler } from './shutdownHandler';

const stubHealthcheck = async (): Promise<void> => Promise.resolve();

export const initLivenessProbe = (container: DependencyContainer): void => {
  const config = container.resolve<IConfig>(SERVICES.CONFIG);
  const serverConfig = config.get<IServerConfig>('server');
  const port: number = parseInt(serverConfig.port) || DEFAULT_SERVER_PORT;

  const server = http.createServer((request, response) => {
    response.end(`running at http://localhost:${port}`);
  });

  const shutdownHandler = container.resolve(ShutdownHandler);

  shutdownHandler.addFunction(async () => {
    return new Promise((resolve) => {
      server.once('close', resolve);
      server.close();
    });
  });

  createTerminus(server, {
    healthChecks: { '/liveness': stubHealthcheck },
    onSignal: shutdownHandler.shutdown.bind(shutdownHandler),
  });

  server.listen(port, () => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    logger.debug(`liveness on port ${port}`);
  });
};
