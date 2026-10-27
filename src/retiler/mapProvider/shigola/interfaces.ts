import type { BoundingBox } from '@map-colonies/tile-calc';

interface ShigolaBaseResponse {
  skipped: number;
  failed: number;
  durationMs: number;
  error?: string;
}

export interface ShigolaTarget {
  map: string;
  layers?: string[];
}

export interface ShigolaRequest {
  bounds: BoundingBox[keyof BoundingBox][];
  zoomRange: { min: number; max: number };
  targets: ShigolaTarget[];
}

export interface ShigolaPurgeResponse extends ShigolaBaseResponse {
  purged: number;
}

export interface ShigolaSeedResponse extends ShigolaBaseResponse {
  seeded: number;
}

export type ShigolaResponse = ShigolaPurgeResponse | ShigolaSeedResponse;
