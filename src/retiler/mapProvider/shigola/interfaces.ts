import type { BoundingBox } from '@map-colonies/tile-calc';

interface ShigolaBaseResponse {
  skipped: number;
  failed: number;
  durationMs: number;
  error?: string;
}

export interface ShigolaRequest {
  bounds: BoundingBox[keyof BoundingBox][];
  zoomRange: { min: number; max: number };
  targets: { map: string }[];
}

export interface ShigolaPurgeResponse extends ShigolaBaseResponse {
  purged: number;
}

export interface ShigolaSeedResponse extends ShigolaBaseResponse {
  seeded: number;
}

export type ShigolaResponse = ShigolaPurgeResponse | ShigolaSeedResponse;
