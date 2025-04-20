global.performance = require('perf_hooks').performance;
const { initConfig } = require('../../src/common/config');

beforeAll(async () => {
  await initConfig(true);
});
