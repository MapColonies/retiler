import { Readable } from 'stream';

export const bufferToStream = (buffer: Buffer): Readable => {
  const readableInstanceStream = new Readable({
    read(): void {
      this.push(buffer);
      this.push(null);
    },
  });

  return readableInstanceStream;
};
