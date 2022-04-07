import ms from 'ms';

const DEFAULT_PRECISION = 2;

export const roundMs = (number: number, precision = DEFAULT_PRECISION): string => {
  const fixed = number.toFixed(precision);
  return ms(+fixed);
};

export const timerify = async <R, A extends unknown[]>(func: (...args: A) => Promise<R>, ...args: A): Promise<[R, number]> => {
  const startTime = performance.now();

  const funcResult = await func(...args);

  const endTime = performance.now();

  return [funcResult, endTime - startTime];
};
