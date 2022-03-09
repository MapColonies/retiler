import { ExitCodes } from './constants';

export class ErrorWithExitCode extends Error {
  public constructor(message?: string, public exitCode: number = ExitCodes.GENERAL_ERROR) {
    super(message);
    this.exitCode = exitCode;
    Object.setPrototypeOf(this, ErrorWithExitCode.prototype);
  }
}

export class S3Error extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.S3_ERROR);
    Object.setPrototypeOf(this, S3Error.prototype);
  }
}

export class HttpUpstreamResponseError extends ErrorWithExitCode {
  public constructor(message?: string) {
    super(message, ExitCodes.REMOTE_SERVICE_RESPONSE_ERROR);
    Object.setPrototypeOf(this, HttpUpstreamResponseError.prototype);
  }
}
