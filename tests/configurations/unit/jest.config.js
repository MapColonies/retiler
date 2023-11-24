module.exports = {
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
    },
  },
  testMatch: ['<rootDir>/tests/unit/**/*.spec.ts'],
  coverageReporters: ['text', 'html'],
  collectCoverage: true,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!*/node_modules/',
    '!/vendor/**',
    '!*/common/**',
    '!**/controllers/**',
    '!**/routes/**',
    '!<rootDir>/src/*',
    '!**/pgbossFactory.ts',
    '!**/tilesStorageProvider/factory.ts',
    '!**/tilesStorageProvider/validation.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  rootDir: '../../../.',
  setupFiles: ['<rootDir>/tests/configurations/jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/matchers.js', '<rootDir>/tests/configurations/jest.setupAfterEnv.js'],
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
