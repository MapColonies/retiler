import { readFile } from 'fs/promises';
import PgBoss, { ConstructorOptions, DatabaseOptions } from 'pg-boss';
import { SERVICE_NAME } from '../../common/constants';

const createDatabaseOptions = async (dbConfig: PgBossConfig): Promise<DatabaseOptions> => {
  const { enableSslAuth, sslPaths, ...databaseOptions } = dbConfig;
  databaseOptions.application_name = SERVICE_NAME;
  if (enableSslAuth) {
    databaseOptions.password = undefined;
    const [ca, cert, key] = await Promise.all([readFile(sslPaths.ca), readFile(sslPaths.cert), readFile(sslPaths.key)]);
    databaseOptions.ssl = { key, cert, ca };
  }
  return databaseOptions;
};

export type PgBossConfig = {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
  certSecretName: string;
} & ConstructorOptions;

export const pgBossFactory = async (bossConfig: PgBossConfig): Promise<PgBoss> => {
  const databaseOptions = await createDatabaseOptions(bossConfig);
  return new PgBoss(databaseOptions);
};
