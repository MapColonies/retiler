import type { BoundingBox } from '@map-colonies/tile-calc';

export interface ShigolaRequest {
  bounds: BoundingBox[keyof BoundingBox][];
  zoomRange: { min: number; max: number };
  targets: { map: string }[];
}

export interface ShigolaResponse {
  purged: number;
  seeded: number;
  skipped: number;
  failed: number;
  durationMs: number;
  error?: string;
}
