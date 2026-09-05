/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
  clearMocks: true,
  // Node's global fetch (undici) can keep an idle keep-alive socket open
  // in tests where a health check probes an unreachable service; this
  // avoids flaky "did not exit" warnings in CI.
  forceExit: true,
};
