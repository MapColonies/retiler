import { readFileSync } from 'fs';
import PgBoss, { DatabaseOptions } from 'pg-boss';
import { type vectorRetilerV1Type } from '@map-colonies/schemas';
import { SERVICE_NAME } from '../../common/constants';

const createDatabaseOptions = (dbConfig: PgBossConfig): DatabaseOptions => {
  let ssl: Omit<vectorRetilerV1Type['app']['jobQueue']['pgBoss']['ssl'], 'enabled'> | undefined = undefined;

  const { ssl: inputSsl, ...databaseOptions } = dbConfig;
  if (inputSsl.enabled) {
    ssl = { key: readFileSync(inputSsl.key, 'utf8'), cert: readFileSync(inputSsl.cert, 'utf8'), ca: readFileSync(inputSsl.ca, 'utf8') };
  }
  return {
    ...databaseOptions,
    ssl,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    application_name: SERVICE_NAME,
  };
};

export type PgBossConfig = vectorRetilerV1Type['app']['jobQueue']['pgBoss'];

export const pgBossFactory = (bossConfig: PgBossConfig): PgBoss => {
  const databaseOptions = createDatabaseOptions(bossConfig);
  return new PgBoss({ ...bossConfig, ...databaseOptions, user: bossConfig.username, noScheduling: true });
};
