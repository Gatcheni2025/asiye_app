const ENDPOINTS = [
  'createClubBookingSecure',
  'joinClubPoolSecure',
  'getClubPickupPin',
  'clubDriverActionSecure',
  'submitWorkEarlyDepartureOffer',
];
const ORIGINS = [
  'https://appassets.androidplatform.net',
  'https://asiye-80386.web.app',
];
const BASE = 'https://us-central1-asiye-80386.cloudfunctions.net';

async function checkEndpoint(endpoint, origin, request = fetch) {
  const url = `${BASE}/${endpoint}`;
  const preflight = await request(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,x-firebase-auth,content-type',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (preflight.status !== 204)
    throw new Error(`${endpoint}: preflight HTTP ${preflight.status}; backend deployment or public invoker access is missing.`);
  const allowedOrigin = preflight.headers.get('access-control-allow-origin');
  if (allowedOrigin !== '*' && allowedOrigin !== origin)
    throw new Error(`${endpoint}: ${origin} is not allowed by CORS.`);
  const headers = (preflight.headers.get('access-control-allow-headers') || '').toLowerCase().split(',').map(s => s.trim());
  if (!['authorization', 'x-firebase-auth', 'content-type'].every(h => headers.includes(h)))
    throw new Error(`${endpoint}: CORS does not permit the installed app's authentication headers.`);
  const methods = (preflight.headers.get('access-control-allow-methods') || '').split(',').map(s => s.trim().toUpperCase());
  if (!methods.includes('POST')) throw new Error(`${endpoint}: CORS does not permit POST.`);
  // No customer account or booking is created: missing auth must fail before validation/writes.
  const response = await request(url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30000),
  });
  const responseOrigin = response.headers.get('access-control-allow-origin');
  if (responseOrigin !== '*' && responseOrigin !== origin)
    throw new Error(`${endpoint}: POST response is blocked by CORS.`);
  if (response.status !== 401)
    throw new Error(`${endpoint}: unauthenticated POST returned HTTP ${response.status}, expected 401.`);
  const body = await response.json();
  if (!body.error) throw new Error(`${endpoint}: authentication rejection is not a JSON error.`);
}

async function main() {
  let failed = false;
  for (const endpoint of ENDPOINTS) {
    for (const origin of ORIGINS) {
      try {
        await checkEndpoint(endpoint, origin);
        console.log(`PASS ${endpoint} (${origin}): CORS and authentication`);
      } catch (error) {
        failed = true;
        console.error(error.message);
      }
    }
  }
  if (failed) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { checkEndpoint, ENDPOINTS };
