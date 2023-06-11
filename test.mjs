import 'reflect-metadata';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import PgBoss from 'pg-boss';
import pino from 'pino';
import { PgBossJobQueueProvider } from './dist/retiler/jobQueueProvider/pgBossJobQueue.js';

const boss = new PgBoss({ user: 'postgres', password: 'postgres', database: 'avi' });
const provider = new PgBossJobQueueProvider(boss, pino(), 'avi');

await provider.startQueue();

// await boss.insert(new Array(5000).fill(0).map((v, i) => ({ name: 'avi', data: i })));

let i = 0;

const consumer = provider.consumeQueue(async (v, id) => {
  i++;
  await setTimeoutPromise(100);
}, 2);

const interval = setInterval(() => {
  console.log(i);
}, 100);

console.log('created queue');
await setTimeoutPromise(500);
console.log('waited for 500');
await provider.stopQueue();
await consumer;
console.log('stopped');
clearInterval(interval);
