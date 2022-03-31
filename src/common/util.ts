import ms from 'ms';

const DEFAULT_PRECISION = 2;

export const roundMs = (number: number, precision = DEFAULT_PRECISION): string => {
  const fixed = number.toFixed(precision);
  return ms(+fixed);
};

export const measurePromise = async <T>(promise: Promise<T>): Promise<[T, number]> => {
  let promiseResult: T;
  let endTime: number;
  const startTime = performance.now();

  try {
    promiseResult = await promise;
  } finally {
    endTime = performance.now();
  }

  return [promiseResult, endTime - startTime];
};
