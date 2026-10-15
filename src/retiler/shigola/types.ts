import type { VectorRetilerSchemaType } from '../../common/config';

export type ShigolaConfig = Extract<VectorRetilerSchemaType['app']['map'], { provider: 'shigola' }>['shigola'];

export type ShigolaOperation = ShigolaConfig['operation'];

export type ShigolaTarget = ShigolaConfig['targets'][number];

export interface ShigolaCacheRequest {
  bounds: [number, number, number, number];
  zoomRange: { min: number; max: number };
  targets: ShigolaTarget[];
  tileMatrixSets?: string[];
  overwrite?: boolean;
}

export interface ShigolaCacheResponse {
  seeded?: number;
  purged?: number;
  skipped: number;
  failed: number;
}

export interface ShigolaErrorResponse {
  error?: string;
}
