import { readFile } from 'fs/promises';
import { ConstructorOptions, DatabaseOptions } from 'pg-boss';
import { SERVICE_NAME } from '../../common/constants';

export const createDatabaseOptions = async (dbConfig: DbOptions): Promise<ConstructorOptions> => {
  const { enableSslAuth, sslPaths, ...databaseOptions } = dbConfig;
  databaseOptions.application_name = SERVICE_NAME;
  if (enableSslAuth) {
    databaseOptions.password = undefined;
    const [ca, cert, key] = await Promise.all([readFile(sslPaths.ca), readFile(sslPaths.cert), readFile(sslPaths.key)]);
    databaseOptions.ssl = { key, cert, ca };
  }
  return databaseOptions;
};

export type DbConfig = {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
  certSecretName: string;
} & DatabaseOptions;

export type DbOptions = DbConfig & ConstructorOptions;
