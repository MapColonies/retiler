import jsLogger from '@map-colonies/js-logger';
import { JobQueueProvider, MapProvider, MapSplitterProvider, TilesStorageProvider } from '../../src/retiler/interfaces';
import { TileProcessor } from '../../src/retiler/tileProcessor';

describe('TileProcessor', () => {
    let processor: TileProcessor;
    let jobQueueProv: JobQueueProvider;
    let mapProv: MapProvider;
    let mapSplitterProv: MapSplitterProvider;
    let tilesStorageProv: TilesStorageProvider;

    describe('#processRequest', () => {
        const get = jest.fn();
        const getMap = jest.fn();
        const splitMap = jest.fn();
        const storeTile = jest.fn();

        beforeEach(function () {
            jobQueueProv = {
                queueName: 'test',
                get,
                isEmpty: jest.fn(),
                complete: jest.fn(),
                fail: jest.fn(),
                startQueue: jest.fn(),
                stopQueue: jest.fn()
            }

            mapProv = {
                getMap
            }

            mapSplitterProv = {
                splitMap
            }

            tilesStorageProv = {
                storeTile
            }

            processor = new TileProcessor(jsLogger({ enabled: false }), jobQueueProv, mapProv, mapSplitterProv, tilesStorageProv);
        });

        afterEach(function () {
            jest.clearAllMocks();
        });

        it('should report success if job queue was empty and t onot do any processing', async () => {
            get.mockResolvedValue(null);

            const expectedReport = { successful: true, jobCompleted: false };

            const processPromise = processor.proccessRequest();

            await expect(processPromise).resolves.toMatchObject(expectedReport);

            expect(jobQueueProv.complete).not.toHaveBeenCalled();
            expect(jobQueueProv.fail).not.toHaveBeenCalled();
            expect(mapProv.getMap).not.toHaveBeenCalled();
            expect(mapSplitterProv.splitMap).not.toHaveBeenCalled();
            expect(tilesStorageProv.storeTile).not.toHaveBeenCalled();
        });
    })
});
