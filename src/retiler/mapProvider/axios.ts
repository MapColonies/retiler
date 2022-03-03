// import { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
// import { stringify } from 'qs';
// import { inject, injectable } from 'tsyringe';
// import { SERVICES } from '../../common/constants';
// import { HttpUpstreamResponseError, HttpUpstreamUnavailableError } from '../../common/errors';
// import { MapProvider } from '../interfaces';
// import { HttpResponse, RequestParams } from './interfaces';

// // @injectable()
// // export class AxiosMap implements MapProvider {
// //   public constructor(@inject(SERVICES.LOGGER) logger: Logger, @inject(SERVICES.HTTP_CLIENT) private readonly httpClient: AxiosInstance) {}

// //   //   public async getMap(bbox: BoundingBox): Buffer {
// //   //   }
// // }

// // TODO: organize types
// type AxiosRequestArgs = AxiosRequestArgsWithoutData; // | AxiosRequestArgsWithData<T>;
// export type AxiosRequestArgsWithoutData = [string, AxiosRequestConfig?];
// // export type AxiosRequestArgsWithData<T> = [string, T?, AxiosRequestConfig?];

// export type Rs<T> = T extends NodeJS.ReadStream ? ReadableStream : T;

// export abstract class BaseClient {
//   public invokeHttp = async <T, A extends AxiosRequestArgs, F extends (...args: A) => Promise<AxiosResponse<T>>>(
//     func: F,
//     ...args: A
//   ): // ): Promise<HttpResponse<T>> => {
//   // ): Promise<ReadableStream<T>> => {
//   // ): Promise<HttpResponse<T> | ReadableStream<T>> => {
//   Promise<HttpResponse<T>> => {
//     try {
//       const response = await func(...args);

//       // if ('pipeTo' in response.data) {
//       //   response.data.pipeTo();
//       // } else {
//       //   return { data: response.data, contentType: response.headers['content-type'], code: response.status };
//       // }

//       // response.data.pipe(fs.createWriteStream('./someimage.jpg'));
//       // response.
//       return { data: response.data, contentType: response.headers['content-type'], code: response.status };
//     } catch (error) {
//       const axiosError = error as AxiosError<T>;
//       //   this.logger.debug(axiosError.toJSON());
//       //   this.logger.error(`received the following error message: ${axiosError.message}`);
//       if (axiosError.response !== undefined) {
//         throw new HttpUpstreamResponseError(`upstream responded with error`);
//       } else if (axiosError.request !== undefined) {
//         throw new HttpUpstreamUnavailableError('no response received from the upstream');
//       } else {
//         throw new Error('request failed to dispatch');
//       }
//     }
//   };
// }

// export interface DumpMetadataResponse {
//   id: string;
//   name: string;
//   timestamp: string;
//   description: string;
//   url: string;
// }

// @injectable()
// export class AxiosMap extends BaseClient implements MapProvider {
//   public readonly uri: string;

//   public constructor(@inject(SERVICES.HTTP_CLIENT) private readonly httpClient: AxiosInstance) {
//     super();
//     this.uri = httpClient.getUri();
//   }

//   public async getMap(url: string, params: RequestParams): Promise<HttpResponse<Buffer>> {
//     const funcRef = this.httpClient.get.bind(this.httpClient);
//     const res = this.invokeHttp<Buffer, AxiosRequestArgsWithoutData, typeof funcRef>(funcRef, url, {
//       params,
//       paramsSerializer: (params: RequestParams) => stringify(params, { indices: false }),
//     });
//     return res;
//   }

//   public async getMapStream(url: string, params: RequestParams): Promise<HttpResponse<ReadableStream<Buffer>>> {
//     const funcRef = this.httpClient.get.bind(this.httpClient);
//     const res = this.invokeHttp<ReadableStream<Buffer>, AxiosRequestArgsWithoutData, typeof funcRef>(funcRef, url, {
//       responseType: 'stream',
//       params,
//       paramsSerializer: (params: RequestParams) => stringify(params, { indices: false }),
//     });
//     return res;
//   }

//   public async getMapStream2(url: string, params: RequestParams): Promise<HttpResponse<ReadableStream<Buffer>>> {
//     const funcRef = this.httpClient.bind(this.httpClient);
//     const res = this.invokeHttp<ReadableStream<Buffer>, AxiosRequestArgsWithoutData, typeof funcRef>(funcRef, url, {
//       responseType: 'stream',
//       params,
//       paramsSerializer: (params: RequestParams) => stringify(params, { indices: false }),
//     });
//     return res;
//   }
// }
