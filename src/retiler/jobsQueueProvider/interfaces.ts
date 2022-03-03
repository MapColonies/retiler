export interface Job<T = object> {
  id: string;
  name: string;
  data: T;
}
