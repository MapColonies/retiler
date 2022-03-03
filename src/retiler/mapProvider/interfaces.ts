export interface HttpResponse<T> {
  data: T;
  contentType: string;
  code: number;
}
