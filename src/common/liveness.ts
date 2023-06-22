import http from 'http';
import { createTerminus } from '@godaddy/terminus';
import { FactoryFunction } from 'tsyringe';
import { ShutdownHandler } from './shutdownHandler';

const stubHealthcheck = async (): Promise<void> => Promise.resolve();

export type LivenessFactory = (server: http.Server) => http.Server;

export const livenessProbeFactory: FactoryFunction<LivenessFactory> = (container) => {
  const shutdownHandler = container.resolve(ShutdownHandler);
  return (server: http.Server): http.Server => {
    return createTerminus(server, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      healthChecks: { '/liveness': stubHealthcheck },
      onSignal: shutdownHandler.shutdown.bind(shutdownHandler),
    });
  };
};
