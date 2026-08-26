import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

const { Client } = pg;

const baseUrl = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3000';
const totalRequests = Number.parseInt(process.env.PERF_REQUESTS ?? '120', 10);
const concurrency = Number.parseInt(process.env.PERF_CONCURRENCY ?? '20', 10);
const warmupRequests = Number.parseInt(process.env.PERF_WARMUP ?? '10', 10);
const requestTimeoutMs = Number.parseInt(
  process.env.PERF_REQUEST_TIMEOUT_MS ?? '10000',
  10,
);
const poolMax = Number.parseInt(process.env.DB_POOL_MAX ?? '20', 10);
const databaseUrl = process.env.DATABASE_URL;
const outputPath =
  process.env.PERF_OUTPUT ?? 'test/performance/results/dashboard-load.json';

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for pool saturation measurement');
}
if (!Number.isInteger(totalRequests) || totalRequests <= 0) {
  throw new Error('PERF_REQUESTS must be a positive integer');
}
if (!Number.isInteger(concurrency) || concurrency <= 0) {
  throw new Error('PERF_CONCURRENCY must be a positive integer');
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

async function httpRequest(path, options = {}) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
    });
    await response.arrayBuffer();
    return {
      status: response.status,
      durationMs: performance.now() - started,
    };
  } catch (error) {
    return {
      status: 0,
      durationMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runLoad(path, headers = {}) {
  const warmup = [];
  for (let index = 0; index < warmupRequests; index += 1) {
    warmup.push(httpRequest(path, { headers }));
  }
  await Promise.all(warmup);

  const started = performance.now();
  const results = [];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < totalRequests) {
      nextIndex += 1;
      results.push(await httpRequest(path, { headers }));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, totalRequests) }, worker),
  );
  const durationMs = performance.now() - started;
  const successful = results.filter(
    (result) => result.status >= 200 && result.status < 400,
  );
  const durations = successful.map((result) => result.durationMs);
  const errors = results.filter(
    (result) => result.status < 200 || result.status >= 400,
  );
  const statusCounts = {};
  for (const result of results) {
    const key = String(result.status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  return {
    path,
    requests: results.length,
    concurrency,
    durationMs: Number(durationMs.toFixed(2)),
    throughputRps: Number((results.length / (durationMs / 1000)).toFixed(2)),
    successCount: successful.length,
    errorCount: errors.length,
    errorRate: Number((errors.length / results.length).toFixed(4)),
    statusCounts,
    latencyMs: {
      min: durations.length ? Number(Math.min(...durations).toFixed(2)) : null,
      p50:
        percentile(durations, 50) === null
          ? null
          : Number(percentile(durations, 50).toFixed(2)),
      p95:
        percentile(durations, 95) === null
          ? null
          : Number(percentile(durations, 95).toFixed(2)),
      p99:
        percentile(durations, 99) === null
          ? null
          : Number(percentile(durations, 99).toFixed(2)),
      max: durations.length ? Number(Math.max(...durations).toFixed(2)) : null,
    },
    sampleErrors: errors
      .slice(0, 3)
      .map(({ status, error }) => ({ status, error })),
  };
}

async function readPoolSnapshot(client) {
  const result = await client.query(`
    SELECT COUNT(*)::int AS active
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state = 'active'
      AND pid <> pg_backend_pid()
  `);
  return Number(result.rows[0]?.active ?? 0);
}

async function main() {
  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.PERF_LOGIN_EMAIL ?? 'admin@factory.com',
      password: process.env.PERF_LOGIN_PASSWORD,
    }),
  });
  if (!loginResponse.ok) {
    throw new Error(`Benchmark login failed with HTTP ${loginResponse.status}`);
  }
  const loginBody = await loginResponse.json();
  const token = loginBody.access_token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Benchmark login response did not contain access_token');
  }

  const monitor = new Client({ connectionString: databaseUrl });
  await monitor.connect();
  const poolSamples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        poolSamples.push(await readPoolSnapshot(monitor));
      } catch {
        // A sample can be lost during shutdown; request results remain authoritative.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();

  const startedAt = new Date().toISOString();
  const endpoints = [
    await runLoad('/health'),
    await runLoad('/health/ready'),
    await runLoad('/dashboard/stats', { authorization: `Bearer ${token}` }),
  ];
  sampling = false;
  await sampler;
  await monitor.end();

  const maxActiveConnections = poolSamples.length
    ? Math.max(...poolSamples)
    : null;
  const result = {
    benchmark: 'GF-REMAINING-007 dashboard load',
    startedAt,
    finishedAt: new Date().toISOString(),
    configuration: {
      baseUrl,
      totalRequests,
      concurrency,
      warmupRequests,
      requestTimeoutMs,
      appPoolMax: poolMax,
      nodeVersion: process.version,
    },
    poolSaturation: {
      sampleCount: poolSamples.length,
      maxActiveConnections,
      configuredPoolMax: poolMax,
      ratio:
        maxActiveConnections === null || poolMax <= 0
          ? null
          : Number((maxActiveConnections / poolMax).toFixed(4)),
    },
    endpoints,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));

  const maxP95 = process.env.PERF_MAX_P95_MS
    ? Number(process.env.PERF_MAX_P95_MS)
    : null;
  const minThroughput = process.env.PERF_MIN_THROUGHPUT_RPS
    ? Number(process.env.PERF_MIN_THROUGHPUT_RPS)
    : null;
  const maxErrorRate = process.env.PERF_MAX_ERROR_RATE
    ? Number(process.env.PERF_MAX_ERROR_RATE)
    : null;
  const failures = [];
  for (const endpoint of endpoints) {
    if (endpoint.errorCount > 0)
      failures.push(`${endpoint.path}: errorCount=${endpoint.errorCount}`);
    if (maxP95 !== null && endpoint.latencyMs.p95 > maxP95) {
      failures.push(
        `${endpoint.path}: p95=${endpoint.latencyMs.p95}ms > ${maxP95}ms`,
      );
    }
    if (minThroughput !== null && endpoint.throughputRps < minThroughput) {
      failures.push(
        `${endpoint.path}: throughput=${endpoint.throughputRps} < ${minThroughput}`,
      );
    }
    if (maxErrorRate !== null && endpoint.errorRate > maxErrorRate) {
      failures.push(
        `${endpoint.path}: errorRate=${endpoint.errorRate} > ${maxErrorRate}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`Performance gate failed: ${failures.join('; ')}`);
  }
}

await main();
