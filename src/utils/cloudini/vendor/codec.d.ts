export interface CloudiniModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _roboboy_cloudini_decode(input: number, inputSize: number, output: number, capacity: number,
    layout: number, layoutSize: number): number;
}
export default function createModule(): Promise<CloudiniModule>;
