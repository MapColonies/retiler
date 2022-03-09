import { IncomingMessage } from 'http';
import { get, RequestOptions } from 'https';
import { Readable, Transform } from 'stream';
import { injectable } from 'tsyringe';
import { HttpUpstreamResponseError } from '../../common/errors';
import { MapProvider } from '../interfaces';
import { HttpResponse } from './interfaces';

@injectable()
export class HttpsMap implements MapProvider {
  public async getMap(options: string | RequestOptions | URL): Promise<HttpResponse<Buffer>> {
    return new Promise<HttpResponse<Buffer>>((resolve, reject) => {
      get(options, (response: IncomingMessage) => {
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        if (response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode > 299)) {
          return reject(new HttpUpstreamResponseError(`failed to download, got response code '${response.statusCode}'`));
        }

        const data = new Transform();
        response.on('error', (err) => reject(err));
        response.on('data', (chunk) => data.push(chunk));
        response.on('end', () => {
          if (response.statusCode === undefined) {
            return reject(new HttpUpstreamResponseError(`failed to download, status code was not sent`));
          }

          if (response.headers['content-type'] == null) {
            return reject(new HttpUpstreamResponseError(`failed to download, content-type header was not sent`));
          }

          resolve({
            data: data.read() as Buffer,
            contentType: response.headers['content-type'],
            code: response.statusCode,
          });
        });
      });
    });
  }

  public async getMapStream(options: string | RequestOptions | URL): Promise<Readable> {
    return new Promise((resolve, reject) => {
      get(options, (response: IncomingMessage) => {
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        if (response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode > 299)) {
          reject(new HttpUpstreamResponseError(`failed to download, got response code '${response.statusCode}'`));
        }

        response.on('error', (err) => {
          reject(err);
        });
        resolve(response);
      });
    });
  }
}
