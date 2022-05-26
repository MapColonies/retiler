import { Logger } from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import { QUEUE_NAME, SERVICES } from '../../common/constants';
import { JobQueueProvider } from '../interfaces';
import { Job } from './interfaces';

@injectable()
export class PgBossJobQueueProvider implements JobQueueProvider {
  public constructor(
    private readonly pgBoss: PgBoss,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(QUEUE_NAME) private readonly queueName: string
  ) {}

  public get activeQueueName(): string {
    return this.queueName;
  }

  public async startQueue(): Promise<void> {
    this.pgBoss.on('error', (err) => {
      this.logger.error({ err, msg: 'pgboss error' });
    });

    await this.pgBoss.start();
    this.logger.debug({ msg: 'pgboss started' });
  }

  public async stopQueue(): Promise<void> {
    await this.pgBoss.stop();
  }

  public async consumeQueue<T, R = void>(fn: (value: T, jobId?: string) => Promise<R>, parallelism = 1): Promise<void> {
    this.logger.info({ msg: 'started consuming queue', parallelism });

    let jobs: Job<T>[] = [];
    for await (const job of this.getJobsIterator<T>()) {
      jobs.push(job);
      if (jobs.length >= parallelism) {
        this.logger.debug({ msg: 'processing a batch of jobs', count: jobs.length });
        await Promise.all(jobs.map(async (job) => this.handleJob(job, fn)));
        jobs = [];
      }
    }

    if (jobs.length > 0) {
      this.logger.debug({ msg: 'processing the remaining batch of jobs', count: jobs.length });
      await Promise.all(jobs.map(async (job) => this.handleJob(job, fn)));
    }

    this.logger.info({ msg: 'queue is empty' });
  }

  private async handleJob<T, R = void>(job: Job<T>, fn: (value: T, jobId?: string) => Promise<R>): Promise<void> {
    try {
      this.logger.debug({ msg: 'job fetched from queue', jobId: job.id });

      await fn(job.data, job.id);

      this.logger.debug({ msg: 'job completed successfully', jobId: job.id });

      await this.pgBoss.complete(job.id);
    } catch (err) {
      const error = err as Error;
      this.logger.error({ err: error, jobId: job.id });

      await this.pgBoss.fail(job.id, error);
    }
  }

  private async *getJobsIterator<T>(): AsyncGenerator<Job<T>> {
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */ // fetch the job unconditionally until the queue is empty which breaks the loop
    while (true) {
      const job = await this.pgBoss.fetch<T>(this.queueName);
      if (job === null) {
        break;
      }
      yield job;
    }
  }
}
