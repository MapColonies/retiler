import http from 'http';
import { createTerminus } from '@godaddy/terminus';
import { FactoryFunction } from 'tsyringe';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { SERVICES } from './constants';

const stubHealthcheck = async (): Promise<void> => Promise.resolve();

export type LivenessFactory = (server: http.Server) => http.Server;

export const livenessProbeFactory: FactoryFunction<LivenessFactory> = (container) => {
  const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
  return (server: http.Server): http.Server => {
    return createTerminus(server, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      healthChecks: { '/liveness': stubHealthcheck },
      onSignal: cleanupRegistry.trigger.bind(cleanupRegistry),
    });
  };
};
