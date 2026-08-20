import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The unit suite never touches Postgres; this only satisfies config parsing.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://momo:momo@localhost:5432/momo_own_it_test',
      MOMO_PROVIDER: 'mock',
      UNLOCK_HMAC_SECRET: 'test-secret-test-secret-0123',
      BILLING_PERIOD_SECONDS: '604800',
      LOG_LEVEL: 'error',
    },
  },
});
