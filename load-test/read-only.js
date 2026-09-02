// SAFE TO RUN AGAINST PRODUCTION.
//
// Exercises only GET (read-only) endpoints — the actual menu-browsing
// traffic pattern most real visitors generate. Nothing here creates an
// order, sends a WhatsApp/email/SMS, or writes to the database, so
// this can genuinely be pointed at your live site without polluting
// real data or burning through notification-provider quota.
//
// Usage:
//   cd load-test && npm install
//   BASE_URL=https://your-backend-url.up.railway.app npm run test:read

const autocannon = require('autocannon');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
// Duration and connection count deliberately modest by default — start
// small and increase gradually. Jumping straight to a huge number
// against a single-replica Railway service is how you'd find the
// crash point the hard way, mid-test, with real customers possibly
// trying to use the site at the same time.
const DURATION_SECONDS = Number(process.env.DURATION_SECONDS || 30);
const CONNECTIONS = Number(process.env.CONNECTIONS || 10);

async function run() {
  console.log(`\nLoad testing ${BASE_URL} — ${CONNECTIONS} concurrent connections for ${DURATION_SECONDS}s\n`);

  const result = await autocannon({
    url: BASE_URL,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    requests: [
      { method: 'GET', path: '/api/products' },
      { method: 'GET', path: '/api/shop/status' },
    ],
  });

  console.log('\n=== Results ===');
  console.log(`Requests/sec (avg):     ${result.requests.average}`);
  console.log(`Latency (avg):          ${result.latency.average}ms`);
  console.log(`Latency (p99):          ${result.latency.p99}ms`);
  console.log(`Total requests:         ${result.requests.total}`);
  console.log(`2xx responses:          ${result['2xx']}`);
  console.log(`Non-2xx/errors:         ${result.errors + result.timeouts + (result.non2xx || 0)}`);

  const errorRate = (result.errors + result.timeouts + (result.non2xx || 0)) / result.requests.total;
  if (errorRate > 0.01) {
    console.log(`\n⚠ Error rate is ${(errorRate * 100).toFixed(1)}% — this is likely close to or past a real breaking point at this connection count.`);
  } else {
    console.log(`\n✓ Clean run at ${CONNECTIONS} connections. Try increasing CONNECTIONS to find the real ceiling.`);
  }
}

run().catch((err) => {
  console.error('Load test failed to run:', err.message);
  process.exit(1);
});
