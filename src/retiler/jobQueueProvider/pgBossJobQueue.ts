import { Logger } from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import { QUEUE_NAME, SERVICES } from '../../common/constants';
import { timerify } from '../../common/util';
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
      this.logger.error(err, 'pg-boss error');
    });

    await this.pgBoss.start();
  }

  public async stopQueue(): Promise<void> {
    await this.pgBoss.stop();
  }

  public async consumeQueue<T, R = void>(fn: (value: T) => Promise<R>): Promise<void> {
    this.logger.info('consuming queue');

    for await (const job of this.getJobsIterator<T>()) {
      try {
        this.logger.info({ msg: 'job fetched', job: job.id });

        const [, fnDuration] = await timerify(fn, job.data);

        this.logger.info({ msg: 'job completed successfully', job: job.id, duration: fnDuration });

        await this.pgBoss.complete(job.id);
      } catch (err) {
        const error = err as Error;
        this.logger.error({ msg: error, job: job.id });

        await this.pgBoss.fail(job.id, error);
      }
    }

    this.logger.info(`queue is empty`);
  }

  private async *getJobsIterator<T>(): AsyncGenerator<Job<T>> {
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */ // fetch the job unconditionally until queue is empty which breaks the loop
    while (true) {
      const job = await this.pgBoss.fetch<T>(this.queueName);
      if (job === null) {
        break;
      }
      yield job;
    }
  }
}
