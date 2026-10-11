const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEndpoint } = require('./club-network-readiness.cjs');
const origin = 'https://appassets.androidplatform.net';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, X-Firebase-Auth, Content-Type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
function request(preflight, post) {
  return async (_, options) => options.method === 'OPTIONS' ? preflight : post;
}
test('404 missing deployment fails readiness, rather than passing a successful APK build', async () => {
  await assert.rejects(checkEndpoint('createClubBookingSecure', origin, request(new Response('', {status: 404}))), /preflight HTTP 404/);
});
test('reachable authenticated endpoint passes without creating a booking', async () => {
  let posts = 0;
  await checkEndpoint('createClubBookingSecure', origin, async (_, options) => {
    if (options.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    posts++;
    assert.equal(options.body, '{}');
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({error: 'Sign in again.'}, {status: 401, headers: cors});
  });
  assert.equal(posts, 1);
});
test('missing native auth header permission fails CORS readiness', async () => {
  await assert.rejects(checkEndpoint('joinClubPoolSecure', origin, request(new Response(null, {status: 204, headers: {...cors, 'access-control-allow-headers': 'Authorization, Content-Type'}}))), /authentication headers/);
});
test('an unintended origin is rejected', async () => {
  await assert.rejects(checkEndpoint('getClubPickupPin', origin, request(new Response(null, {status: 204, headers: {...cors, 'access-control-allow-origin': 'https://other.example'}}))), /not allowed/);
});
test('public endpoint returning success without authentication fails readiness', async () => {
  await assert.rejects(checkEndpoint('clubDriverActionSecure', origin, request(new Response(null, {status: 204, headers: cors}), Response.json({ok: true}, {headers: cors}))), /expected 401/);
});
