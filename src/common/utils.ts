import { Readable } from 'stream';

export const streamToString = async (stream: Readable): Promise<string> => {
  return new Promise((resolve, reject) => {
    stream.setEncoding('utf8');
    let data = '';
    stream.on('data', (chunk) => (data += chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(data));
  });
};

export const bufferToStream = (buffer: Buffer): Readable => {
  const readableInstanceStream = new Readable({
    read(): void {
      this.push(buffer);
      this.push(null);
    },
  });

  return readableInstanceStream;
};
