import { setInterval as setIntervalPromise } from 'node:timers/promises';
import PgBoss from 'pg-boss';

const WAIT_FOR_JOB_INTERVAL_MS = 10;

export const LONG_RUNNING_TEST = 10000;

export async function waitForJobToBeResolved(boss: PgBoss, jobId: string): Promise<PgBoss.JobWithMetadata | null> {
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
  for await (const _unused of setIntervalPromise(WAIT_FOR_JOB_INTERVAL_MS)) {
    const job = await boss.getJobById(jobId);
    if (job?.completedon) {
      return job;
    }
  }
  return null;
}
