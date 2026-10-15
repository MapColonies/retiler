/**
 * An error that repeating the job cannot fix, such as a request the server refused as invalid.
 * The job queue ends such a job instead of retrying it.
 */
export class NonRetryableError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NonRetryableError';
  }
}
