export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

export interface IServerConfig {
  port: string;
}

export interface IProjectConfig {
  name: string;
  stateUrl: string;
}
