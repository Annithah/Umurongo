// Fails loudly when the test database is missing, instead of silently skipping the API tests.
import { describe, expect, it } from 'vitest';
import { dbReachable, skipDb } from './helpers';

describe.runIf(!skipDb)('API database', () => {
  it('is reachable at TEST_DATABASE_URL or DATABASE_URL (set SKIP_DB_TESTS=1 to skip the API tests on purpose)', () => {
    expect(dbReachable).toBe(true);
  });
});
