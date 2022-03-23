import { createReadStream } from 'fs';
import sharp from 'sharp';
import { SharpMapSplitter } from '../../../src/retiler/mapSplitterProvider/sharp';

describe('SharpMapSplitter', () => {
  describe('#splitMap', () => {
    let splitter: SharpMapSplitter;
    beforeEach(function () {
      splitter = new SharpMapSplitter();
    });
    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should split the image into 4 tiles', async function () {
      const stream = createReadStream('tests/test.png');

      const tiles = await splitter.splitMap({ z: 0, x: 0, y: 0, metatile: 2 }, stream);

      expect(tiles).toHaveLength(4);
      expect(tiles).toEqual(expect.arrayContaining([expect.objectContaining({ z: 0, x: 0, y: 0 }),expect.objectContaining({ z: 0, x: 1, y: 0 }),expect.objectContaining({ z: 0, x: 0, y: 1 }),expect.objectContaining({ z: 0, x: 1, y: 1 })]));

      const assertions = tiles.map(async (tile) => {
        const metadata = await sharp(tile.buffer).metadata();
        expect(metadata).toMatchObject({
          width: 256,
          height: 256,
          format: 'png',
        });
      });
      await Promise.all(assertions);
    });
  });
});
