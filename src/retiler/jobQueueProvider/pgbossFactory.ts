import { readFileSync } from 'fs';
import pgBoss, { ConstructorOptions, DatabaseOptions } from 'pg-boss';
import { SERVICE_NAME } from '../../common/constants';

const createDatabaseOptions = (dbConfig: PgBossConfig): DatabaseOptions => {
  const { ssl, ...databaseOptions } = dbConfig;

  let sslResult;
  if (ssl.enabled) {
    databaseOptions.password = undefined;
    sslResult = { key: readFileSync(ssl.key), cert: readFileSync(ssl.cert), ca: readFileSync(ssl.ca) };
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  return { ...databaseOptions, application_name: SERVICE_NAME, ssl: sslResult };
};

export type PgBossConfig = Omit<ConstructorOptions, 'ssl'> & {
  ssl: { enabled: true; ca: string; cert: string; key: string } | { enabled: false };
};

export const pgBossFactory = (bossConfig: PgBossConfig): pgBoss => {
  const databaseOptions = createDatabaseOptions(bossConfig);
  return new pgBoss({ ...bossConfig, ...databaseOptions, noScheduling: true });
};
