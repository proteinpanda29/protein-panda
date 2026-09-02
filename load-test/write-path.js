// ⚠ DO NOT RUN AGAINST PRODUCTION.
//
// This creates real orders — which, depending on what's configured,
// can trigger real WhatsApp messages, real emails, and real SMS to
// whatever test customer account you point it at, and will pollute
// your real order history/analytics with fake data. Point this at a
// staging deployment (a second Railway service, or run the backend
// locally against a throwaway database) — never your live site.
//
// Usage:
//   cd load-test && npm install
//   BASE_URL=https://your-staging-url.up.railway.app \
//   AUTH_TOKEN=<a real customer JWT, from localStorage after logging in> \
//   I_UNDERSTAND_THIS_CREATES_REAL_ORDERS=yes \
//   npm run test:write

const autocannon = require('autocannon');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const DURATION_SECONDS = Number(process.env.DURATION_SECONDS || 20);
const CONNECTIONS = Number(process.env.CONNECTIONS || 5);

if (process.env.I_UNDERSTAND_THIS_CREATES_REAL_ORDERS !== 'yes') {
  console.error(
    '\nRefusing to run — this creates real orders. Set I_UNDERSTAND_THIS_CREATES_REAL_ORDERS=yes ' +
      'only once you\u2019re certain BASE_URL points at a staging environment, not production.\n',
  );
  process.exit(1);
}

if (/proteinpanda\.shop|railway\.app/.test(BASE_URL) && !process.env.FORCE) {
  console.error(
    `\nBASE_URL (${BASE_URL}) looks like it could be a real deployment, not a local/throwaway one. ` +
      'If this genuinely is a staging service and not production, re-run with FORCE=1 to proceed.\n',
  );
  process.exit(1);
}

if (!AUTH_TOKEN) {
  console.error('\nAUTH_TOKEN is required — log in as a real test customer on your staging site and copy the token from localStorage (pp_token).\n');
  process.exit(1);
}

async function run() {
  console.log(`\nWrite-path load test against ${BASE_URL} — ${CONNECTIONS} connections for ${DURATION_SECONDS}s\n`);
  console.log('This is creating real orders. Remember to clean up test data afterward.\n');

  const result = await autocannon({
    url: BASE_URL,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    requests: [
      {
        method: 'POST',
        path: '/api/orders',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${AUTH_TOKEN}` },
        body: JSON.stringify({
          channel: 'WEBSITE',
          fulfillmentType: 'PICKUP',
          paymentMethod: 'CASH',
          items: [{ productId: process.env.TEST_PRODUCT_ID || 'REPLACE_WITH_A_REAL_PRODUCT_ID', quantity: 1 }],
        }),
      },
    ],
  });

  console.log('\n=== Results ===');
  console.log(`Requests/sec (avg):     ${result.requests.average}`);
  console.log(`Latency (avg):          ${result.latency.average}ms`);
  console.log(`Latency (p99):          ${result.latency.p99}ms`);
  console.log(`2xx responses:          ${result['2xx']}`);
  console.log(`Non-2xx/errors:         ${result.errors + result.timeouts + (result.non2xx || 0)}`);
  console.log('\nRemember: every successful request above created a real order in the database.');
}

run().catch((err) => {
  console.error('Load test failed to run:', err.message);
  process.exit(1);
});
