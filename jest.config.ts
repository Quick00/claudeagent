import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const moduleNameMapper = {
  '^@/(.*)$': '<rootDir>/src/$1',
};

const nodeProject: Config = {
  displayName: 'node',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper,
};

const jsdomProject: Config = {
  displayName: 'jsdom',
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    ...moduleNameMapper,
    // ESM-only packages Jest cannot transform. Stubbed rather than fighting
    // transformIgnorePatterns.
    '^react-markdown$': '<rootDir>/src/test/mocks/react-markdown.tsx',
    '^remark-gfm$': '<rootDir>/src/test/mocks/remark-gfm.ts',
    '^next/navigation$': '<rootDir>/src/test/mocks/next-navigation.ts',
    '^next-auth/react$': '<rootDir>/src/test/mocks/next-auth-react.tsx',
  },
};

// next/jest has to wrap each project individually: it resolves the SWC
// transform and CSS/asset stubs per project root.
const buildConfig = async (): Promise<Config> => ({
  projects: [await createJestConfig(nodeProject)(), await createJestConfig(jsdomProject)()],
});

export default buildConfig;
