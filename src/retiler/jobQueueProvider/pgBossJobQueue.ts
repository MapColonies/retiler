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

  public async complete(id: string, data?: object): Promise<void> {
    const completePromise = data !== undefined ? this.pgBoss.complete(id, data) : this.pgBoss.complete(id);
    await completePromise;
  }

  public async fail(id: string, data?: object): Promise<void> {
    const failPromise = data !== undefined ? this.pgBoss.fail(id, data) : this.pgBoss.fail(id);
    await failPromise;
  }

  public async get<T>(): Promise<Job<T> | null> {
    return this.pgBoss.fetch<T>(this.queueName);
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

  public async *iterateJobs<T>(): AsyncGenerator<Job<T>> {
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */ // fetch the job unconditionally
    while (true) {
      const job = await this.get<T>();
      if (job === null) {
        break;
      }
      yield job;
    }
  }
}
