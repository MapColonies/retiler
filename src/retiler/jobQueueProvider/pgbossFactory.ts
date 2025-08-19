import { readFileSync } from 'fs';
import pgBoss, { DatabaseOptions } from 'pg-boss';
import { type vectorRetilerV1Type } from '@map-colonies/schemas';
import { SERVICE_NAME } from '../../common/constants';

const createDatabaseOptions = (dbConfig: PgBossConfig): DatabaseOptions => {
  const { ssl, ...databaseOptions } = dbConfig;

  const poolConfig: DatabaseOptions = {
    ...databaseOptions,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    application_name: `${SERVICE_NAME}-${dbConfig.projectName ?? 'unknown_env'}-${process.env.NODE_ENV ?? 'unknown_env'}`,
    user: dbConfig.username,
    password: dbConfig.password,
  };

  if (ssl.enabled) {
    delete poolConfig.password;
    try {
      poolConfig.ssl = {
        key: readFileSync(ssl.key),
        cert: readFileSync(ssl.cert),
        ca: readFileSync(ssl.ca),
      };
    } catch (error) {
      throw new Error(`Failed to load SSL certificates. Ensure the files exist and are accessible. Details: ${(error as Error).message}`);
    }
  } else {
    poolConfig.ssl = false;
  }

  return poolConfig;
};

export type PgBossConfig = vectorRetilerV1Type['app']['jobQueue']['pgBoss'] & { projectName?: string };

export const pgBossFactory = (bossConfig: PgBossConfig): pgBoss => {
  const databaseOptions = createDatabaseOptions(bossConfig);
  return new pgBoss({ ...bossConfig, ...databaseOptions, noScheduling: true });
};
