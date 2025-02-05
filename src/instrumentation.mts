// This file handles the tracing initialization and starts the tracing process before the app starts.
// You should be careful about editing this file, as it is a critical part of the application's functionality.
// Because this file is a module it should imported using the `--import` flag in the `node` command, and should not be imported by any other file.
import config from 'config';
import { tracingFactory } from './common/tracing.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const tracingConfig = config.get<any>('telemetry.tracing');
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const sharedConfig = config.get<any>('telemetry.shared');

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
const tracing = tracingFactory({ ...tracingConfig, ...sharedConfig });

tracing.start();
