import { defineConfig } from 'vitest/config';

/*
 * Extra Vitest settings for `ng test` (angular.json → test.options.runnerConfig);
 * the Angular unit-test builder supplies everything else.
 *
 * testTimeout: specs that start a whole StarMap session take 1–3 s alone but
 * 6–12 s while all workers start at once in a full run, which made the 5 s
 * default fail at random. Real hangs still fail, just later.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
  },
});
