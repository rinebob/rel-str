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
  moduleNameMapper: {
    '^@rh-agent-mcp/contracts$': '<rootDir>/shared/robinhood-mcp-contracts.ts',
    '^@rh-agent-mcp/utils$': '<rootDir>/shared/robinhood-mcp-utils.ts',
    '^@options-contract/contracts$': '<rootDir>/shared/options-contract-contracts.ts',
    '^@options/common$': '<rootDir>/shared/options-common.ts',
    '^@common$': '<rootDir>/shared/common.ts',
    '^@options-strategy-engine/contracts$': '<rootDir>/shared/options-strategy-engine-contracts.ts',
    '^@options-strategy-engine/id$': '<rootDir>/shared/strategy-instance-id.ts',
    '^@spread/contracts$': '<rootDir>/shared/spread-contracts.ts',
  },
};
