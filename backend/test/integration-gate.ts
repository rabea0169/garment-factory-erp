if (
  process.env.GF_REQUIRE_INTEGRATION === '1' &&
  !process.env.GF_INTEGRATION_DATABASE_URL
) {
  throw new Error(
    'GF_REQUIRE_INTEGRATION=1 requires GF_INTEGRATION_DATABASE_URL; integration tests must not be skipped.',
  );
}
