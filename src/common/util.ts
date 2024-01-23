import { MILLISECONDS_IN_SECOND, TIMESTAMP_REGEX } from './constants';

export const timerify = async <R, A extends unknown[]>(func: (...args: A) => Promise<R>, ...args: A): Promise<[R, number]> => {
  const startTime = performance.now();

  const funcResult = await func(...args);

  const endTime = performance.now();

  return [funcResult, endTime - startTime];
};

export const streamToString = async (stream: NodeJS.ReadStream): Promise<string> => {
  return new Promise((resolve, reject) => {
    stream.setEncoding('utf8');
    let data = '';
    stream.on('data', (chunk) => (data += chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(data));
  });
};

export const fetchTimestampValue = (content: string): string => {
  const matchResult = content.match(TIMESTAMP_REGEX);
  if (matchResult === null || matchResult.length === 0) {
    throw new Error();
  }

  const value = matchResult[0].split('=')[1];
  return value.replace(/\\/g, '');
};

export const timestampToUnix = (timestamp: string): number => {
  return new Date(timestamp).getTime() / MILLISECONDS_IN_SECOND;
};
