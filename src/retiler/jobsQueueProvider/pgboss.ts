import { Tile } from '@map-colonies/tile-calc';
import PgBoss, { ConstructorOptions } from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import { DB_OPTIONS, QUEUE_NAME } from '../../common/constants';
import { ShutdownHandler } from '../../common/shutdownHandler';
import { JobsQueueProvider } from '../interfaces';
import { Job } from './interfaces';

@injectable()
export class PgBossJobsQueue extends PgBoss implements JobsQueueProvider {
  public constructor(
    @inject(ShutdownHandler) private readonly shutdownHandler: ShutdownHandler,
    @inject(QUEUE_NAME) private readonly queueName: string,
    @inject(DB_OPTIONS) private readonly dbOptions: ConstructorOptions
  ) {
    super(dbOptions);
    this.shutdownHandler.addFunction(this.stop.bind(this));

    void this.init();
  }

  public async get<T>(): Promise<Job<T> | null> {
    return this.fetch<T>(this.queueName);
  }

  public async isEmpty(): Promise<boolean> {
    const count = await this.getQueueSize(this.queueName);
    return count === 0;
  }

  private async init(): Promise<void> {
    await this.start();
  }
}
