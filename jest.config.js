module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.devin/', '<rootDir>/functions/node_modules/'],
  // Extends the jest-preset-angular CJS default (which transforms *.mjs +
  // @angular/common/locales) to also transform `jose` — an ESM-only package
  // reached via firebase-functions when testing functions/src helpers.
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$|@angular/common/locales/.*\\.js$|jose/))',
  ],
  transform: {
    '^.+\\.(ts|js|mjs|html|svg)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'html', 'js', 'json'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@robinhood-mcp/contracts$': '<rootDir>/shared/robinhood-mcp-contracts.ts',
    '^@robinhood-mcp/utils$': '<rootDir>/shared/robinhood-mcp-utils.ts',
    '^@options-contract/contracts$': '<rootDir>/shared/options-contract-contracts.ts',
    '^@options/common$': '<rootDir>/shared/options-common.ts',
    '^@common$': '<rootDir>/shared/common.ts',
    '^@options-strategy-engine/contracts$': '<rootDir>/shared/options-strategy-engine-contracts.ts',
    '^@options-strategy-engine/id$': '<rootDir>/shared/strategy-instance-id.ts',
    '^@paper-trading/contracts$': '<rootDir>/shared/paper-trading-contracts.ts',
    '^@paper-trading/ids$': '<rootDir>/shared/paper-trading-ids.ts',
    '^@spread/contracts$': '<rootDir>/shared/spread-contracts.ts',
  },
};
