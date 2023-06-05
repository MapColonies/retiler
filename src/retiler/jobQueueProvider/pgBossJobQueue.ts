import EventEmitter from 'node:events';
import { setTimeout as setTimeoutPromise, setImmediate as setImmediatePromise } from 'node:timers/promises';
import { Logger } from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import { QUEUE_EMPTY_TIMEOUT, QUEUE_NAME, SERVICES } from '../../common/constants';
import { JobQueueProvider } from '../interfaces';
import { Job } from './interfaces';

@injectable()
export class PgBossJobQueueProvider implements JobQueueProvider {
  private isRunning = false;
  private isDraining = false;
  private runningJobs = 0;

  private readonly jobFinishedEmitter = new EventEmitter();
  private readonly jobFinishedEventName = 'avi';

  public constructor(
    private readonly pgBoss: PgBoss,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(QUEUE_NAME) private readonly queueName: string,
    @inject(QUEUE_EMPTY_TIMEOUT) private readonly queueWaitTimeout: number
  ) {}

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
      throw new Error('queue is already stopped');
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
      void this.handleJob(job, fn);
      if (this.runningJobs >= parallelism) {        
        await new Promise<void>((resolve) => {
          const listner = (): void => {
            if (this.runningJobs < parallelism) {
              this.jobFinishedEmitter.removeListener(this.jobFinishedEventName, listner);
              resolve();
            }
          };
          this.jobFinishedEmitter.on(this.jobFinishedEventName, listner);
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
      const listner = (): void => {
        if (this.runningJobs === 0) {
          this.jobFinishedEmitter.removeListener(this.jobFinishedEventName, listner);
          resolve();
        }
      };
      this.jobFinishedEmitter.on(this.jobFinishedEventName, listner);
    });
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
    } finally {
      this.runningJobs--;
      await setImmediatePromise();
      this.jobFinishedEmitter.emit(this.jobFinishedEventName);
    }
  }

  private async *getJobsIterator<T>(): AsyncGenerator<Job<T>> {
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */ // fetch the job unconditionally until the queue ends
    while (true) {
      if (this.isDraining || !this.isRunning) {
        break;
      }

      const job = await this.pgBoss.fetch<T>(this.queueName);

      if (job === null) {
        this.logger.info({ msg: 'queue is empty, waiting for data' });
        await setTimeoutPromise(this.queueWaitTimeout);
        continue;
      }

      yield job;
    }
  }
}
