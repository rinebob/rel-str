module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.(ts|js|html)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.html$',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'html', 'js', 'json'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
};