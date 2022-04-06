import { Logger } from '@map-colonies/js-logger';
import { Tile } from '@map-colonies/tile-calc';
import { inject, injectable } from 'tsyringe';
import { JOB_QUEUE_PROVIDER, SERVICES } from '../common/constants';
import { measurePromise, roundMs } from '../common/util';
import { JobQueueProvider } from './interfaces';
import { TileProcessor } from './tileProcessor';

@injectable()
export class TileConsumer {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(JOB_QUEUE_PROVIDER) private readonly jobQueueProvider: JobQueueProvider,
    @inject(TileProcessor) private readonly processor: TileProcessor
  ) {}

  public async consumeTile(): Promise<void> {
    this.logger.info(`consuming queue ${this.jobQueueProvider.activeQueueName}`);

    for await (const job of this.jobQueueProvider.iterateJobs<Tile>()) {
      const tile = { ...job.data, metatile: job.data.metatile ?? 1 };

      try {
        const processPromise = this.processor.processTile(tile);
        const [, processingDuration] = await measurePromise(processPromise);

        this.logger.info(`processing of ${job.id} completed successfully in ${roundMs(processingDuration)}`);

        await this.jobQueueProvider.complete(job.id);
      } catch (err) {
        const error = err as Error;
        this.logger.error(error);

        await this.jobQueueProvider.fail(job.id, error);
      }
    }

    this.logger.info(`finished consuming ${this.jobQueueProvider.activeQueueName} is empty`);
  }
}
