import { EventEmitter } from 'node:events';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { Registry, Gauge } from 'prom-client';
import { type Logger } from '@map-colonies/js-logger';
import pgBoss, { JobWithMetadata } from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import { serializeError } from 'serialize-error';
import { METRICS_REGISTRY, QUEUE_EMPTY_TIMEOUT, QUEUE_NAME, SERVICES } from '../../common/constants';
import { JobQueueProvider } from '../interfaces';

@injectable()
export class PgBossJobQueueProvider implements JobQueueProvider {
  private isRunning = false;
  private isDraining = false;
  private runningJobs = 0;

  private readonly jobFinishedEmitter = new EventEmitter();
  private readonly jobFinishedEventName = 'jobFinished';

  public constructor(
    @inject(SERVICES.PGBOSS) private readonly pgBoss: pgBoss,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(QUEUE_NAME) private readonly queueName: string,
    @inject(QUEUE_EMPTY_TIMEOUT) private readonly queueWaitTimeout: number,
    @inject(METRICS_REGISTRY) registry?: Registry
  ) {
    if (registry !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      new Gauge({
        name: 'retiler_current_running_job_count',
        help: 'The number of jobs currently running',
        /* istanbul ignore next */
        collect(): void {
          this.set(self.runningJobs);
        },
        registers: [registry],
      });
    }
  }

  public get activeQueueName(): string {
    return this.queueName;
  }

  public async startQueue(): Promise<void> {
    if (this.isRunning || this.isDraining) {
      throw new Error('queue already running');
    }
    this.isRunning = true;
    this.pgBoss.on('error', (err) => {
      this.logger.error({ err, msg: 'pgboss error' });
    });
    await this.pgBoss.start();
    this.logger.debug({ msg: 'pgboss started' });
  }

  public async stopQueue(): Promise<void> {
    this.logger.debug({ msg: 'stopping queue' });
    if (!this.isRunning || this.isDraining) {
      return;
    }
    this.isDraining = true;
    await this.waitForQueueToEmpty();
    await this.pgBoss.stop();
    this.isRunning = this.isDraining = false;
  }

  public async consumeQueue<T, R = void>(fn: (value: T, jobId?: string) => Promise<R>, parallelism = 1): Promise<void> {
    this.logger.info({ msg: 'started consuming queue', parallelism });
    for await (const job of this.getJobsIterator<T>()) {
      if (this.isDraining || !this.isRunning) {
        break;
      }

      this.runningJobs++;
      this.logger.debug({ msg: 'starting job', runningJobs: this.runningJobs });

      void this.handleJob(job, fn);
      if (this.runningJobs >= parallelism) {
        await new Promise<void>((resolve) => {
          const listener = (): void => {
            if (this.runningJobs < parallelism) {
              this.jobFinishedEmitter.removeListener(this.jobFinishedEventName, listener);
              resolve();
            }
          };
          this.jobFinishedEmitter.on(this.jobFinishedEventName, listener);
        });
      }
    }

    await this.waitForQueueToEmpty();
  }

  private async waitForQueueToEmpty(): Promise<void> {
    if (this.runningJobs === 0) {
      return;
    }

    return new Promise((resolve) => {
      const listener = (): void => {
        if (this.runningJobs === 0) {
          this.jobFinishedEmitter.removeListener(this.jobFinishedEventName, listener);
          resolve();
        }
      };
      this.jobFinishedEmitter.on(this.jobFinishedEventName, listener);
    });
  }

  private async handleJob<T, R = void>(job: JobWithMetadata<T>, fn: (value: T, jobId?: string) => Promise<R>): Promise<void> {
    try {
      this.logger.debug({ msg: 'job fetched from queue', jobId: job.id });
      await fn(job.data, job.id);
      this.logger.debug({ msg: 'job completed successfully', jobId: job.id });
      await this.pgBoss.complete(job.id);
    } catch (err) {
      const error = err as Error;
      this.logger.error({ err: error, jobId: job.id, job });
      await this.pgBoss.fail(job.id, serializeError(error));
    } finally {
      this.runningJobs--;
      this.logger.debug({ msg: 'finished job, emitting job completed event', runningJobs: this.runningJobs });
      process.nextTick(() => this.jobFinishedEmitter.emit(this.jobFinishedEventName));
    }
  }

  private async *getJobsIterator<T>(): AsyncGenerator<pgBoss.JobWithMetadata<T>> {
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */ // fetch the job unconditionally until the queue ends
    while (true) {
      if (this.isDraining || !this.isRunning) {
        break;
      }

      const jobs = await this.pgBoss.fetch<T>(this.queueName, 1, { includeMetadata: true });

      if (jobs === null || jobs.length === 0 || jobs[0] === undefined) {
        this.logger.info({ msg: 'queue is empty, waiting for data' });
        await setTimeoutPromise(this.queueWaitTimeout);
        continue;
      }

      yield jobs[0];
    }
  }
}
