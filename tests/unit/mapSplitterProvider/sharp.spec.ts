import { readFile } from 'fs/promises';
import sharp from 'sharp';
import { faker } from '@faker-js/faker';
import jsLogger from '@map-colonies/js-logger';
import { Tile } from '@map-colonies/tile-calc';
import { SharpMapSplitter } from '../../../src/retiler/mapSplitterProvider/sharp';

describe('SharpMapSplitter', () => {
  describe('#splitMap', () => {
    let splitter: SharpMapSplitter;
    beforeEach(function () {
      splitter = new SharpMapSplitter(jsLogger({ enabled: false }), false);
    });
    afterEach(function () {
      jest.clearAllMocks();
    });

    it('should split 2048x2048 image into 64 tiles on zoom levels larger or equal to 3', async function () {
      const metatileValue = 8;
      const zoom = faker.number.int({ min: 3, max: 20 });
      const buffer = await readFile('tests/2048x2048.png');

      const tilesWithBuffers = await splitter.splitMap({ z: zoom, x: 0, y: 0, metatile: metatileValue, buffer });
      const tiles = tilesWithBuffers.map((tileWithBuffer) => {
        const { buffer, ...tile } = tileWithBuffer;
        return tile;
      });

      const expectedTiles: Tile[] = [];
      for (let i = 0; i < metatileValue; i++) {
        for (let j = 0; j < metatileValue; j++) {
          expectedTiles.push({ z: zoom, x: i, y: j, metatile: 1 });
        }
      }

      expect(tiles).toContainSameTiles(expectedTiles);

      const assertions = tilesWithBuffers.map(async (tile) => {
        const metadata = await sharp(tile.buffer).metadata();
        expect(metadata).toMatchObject({
          width: 256,
          height: 256,
          format: 'png',
        });
      });
      await Promise.all(assertions);
    });

    it('should split 2048x2048 image into 8 tiles on zoom 1, the rest are out of bounds', async function () {
      const buffer = await readFile('tests/2048x2048.png');

      const tilesWithBuffers = await splitter.splitMap({ z: 1, x: 0, y: 0, metatile: 8, buffer });
      const tiles = tilesWithBuffers.map((tileWithBuffer) => {
        const { buffer, ...tile } = tileWithBuffer;
        return tile;
      });

      expect(tiles).toContainSameTiles([
        { z: 1, x: 0, y: 0, metatile: 1 },
        { z: 1, x: 1, y: 0, metatile: 1 },
        { z: 1, x: 2, y: 0, metatile: 1 },
        { z: 1, x: 3, y: 0, metatile: 1 },
        { z: 1, x: 0, y: 1, metatile: 1 },
        { z: 1, x: 1, y: 1, metatile: 1 },
        { z: 1, x: 2, y: 1, metatile: 1 },
        { z: 1, x: 3, y: 1, metatile: 1 },
      ]);

      const assertions = tilesWithBuffers.map(async (tile) => {
        const metadata = await sharp(tile.buffer).metadata();
        expect(metadata).toMatchObject({
          width: 256,
          height: 256,
          format: 'png',
        });
      });
      await Promise.all(assertions);
    });

    it('should split 256x256 image into only 2 tiles which are not out of bounds on zoom level 1, on every metatile value larger than 1', async function () {
      const metatileValue = faker.number.int({ min: 2, max: 22 });
      const buffer = await readFile('tests/512x512.png');

      const tiles = await splitter.splitMap({ z: 0, x: 0, y: 0, metatile: metatileValue, buffer });

      expect(tiles).toContainSameTiles([
        { z: 0, x: 0, y: 0, metatile: 1 },
        { z: 0, x: 1, y: 0, metatile: 1 },
      ]);

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

    it('should split 2048x2048 image into only 1 tile as it have empty subtiles and SHOULD_FILTER_BLANK_TILES it true', async () => {
      const splitter = new SharpMapSplitter(jsLogger({ enabled: false }), true);
      const buffer = await readFile('tests/2048x2048.png');

      const tiles = await splitter.splitMap({ z: 1, x: 0, y: 0, metatile: 8, buffer });

      expect(tiles).toHaveLength(5);
      expect(tiles).toContainSameTiles([
        { z: 1, x: 2, y: 0, metatile: 1 },
        { z: 1, x: 3, y: 0, metatile: 1 },
        { z: 1, x: 1, y: 1, metatile: 1 },
        { z: 1, x: 2, y: 1, metatile: 1 },
        { z: 1, x: 3, y: 1, metatile: 1 },
      ]);

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
