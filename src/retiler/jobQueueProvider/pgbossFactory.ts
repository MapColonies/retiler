import { readFileSync } from 'fs';
import PgBoss, { ConstructorOptions, DatabaseOptions } from 'pg-boss';
import { SERVICE_NAME } from '../../common/constants';

const createDatabaseOptions = (dbConfig: PgBossConfig): DatabaseOptions => {
  const { enableSslAuth, sslPaths, ...databaseOptions } = dbConfig;
  databaseOptions.application_name = SERVICE_NAME;
  if (enableSslAuth) {
    databaseOptions.password = undefined;
    databaseOptions.ssl = { key: readFileSync(sslPaths.key), cert: readFileSync(sslPaths.cert), ca: readFileSync(sslPaths.ca) };
  }
  return databaseOptions;
};

export type PgBossConfig = {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
  certSecretName: string;
} & ConstructorOptions;

export const pgBossFactory = (bossConfig: PgBossConfig): PgBoss => {
  const databaseOptions = createDatabaseOptions(bossConfig);
  return new PgBoss({ ...bossConfig, ...databaseOptions, noScheduling: true });
};
