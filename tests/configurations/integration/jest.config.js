module.exports = {
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  coverageReporters: ['text', 'html'],
  collectCoverage: true,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!*/node_modules/',
    '!/vendor/**',
    '!*/common/**',
    '!**/index.ts',
    '!**/containerConfig.ts',
    '!**/pgbossFactory.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  rootDir: '../../../.',
  testMatch: ['<rootDir>/tests/integration/**/*.spec.ts'],
  setupFiles: ['<rootDir>/tests/configurations/jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/configurations/jest.setupAfterEnv.js'],
  globalSetup: '<rootDir>/tests/configurations/integration/jest.globalSetup.ts',
  moduleDirectories: ['node_modules', 'src'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: -10,
    },
  },
};
