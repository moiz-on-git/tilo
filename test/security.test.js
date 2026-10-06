const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.NODE_ENV = 'test';
delete process.env.APP_ORIGIN;
delete process.env.ALLOWED_ORIGINS;
// Configure the server before it is loaded. The backend only accepts a
// forwarding header from this peer, which represents the local test proxy.
process.env.TRUST_PROXY = '1';
process.env.TRUSTED_PROXY_IPS = '127.0.0.1';
process.env.MAX_HANDSHAKES_PER_MINUTE = '5';

const { io, server } = require('../server');

let baseUrl;
let handshakeCounter = 0;

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function handshake(headers = {}) {
  handshakeCounter += 1;
  return request(`/socket.io/?EIO=4&transport=polling&t=securitytest${handshakeCounter}`, {
    Origin: baseUrl,
    ...headers,
  });
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  io.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
});

test('serves the application with restrictive browser security headers', async () => {
  const response = await request('/');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-security-policy'], /default-src 'self'/);
  assert.match(response.headers['content-security-policy'], /script-src 'self'/);
  assert.doesNotMatch(response.headers['content-security-policy'], /cdn\.socket\.io/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['cache-control'], 'no-cache');
  assert.match(response.body, /src="\/socket\.io\/socket\.io\.js"/);
  assert.doesNotMatch(response.body, /cdn\.socket\.io/);
});

test('only accepts Socket.IO handshakes from the configured first-party origin', async () => {
  const allowed = await handshake({ 'X-Forwarded-For': '203.0.113.10' });
  const denied = await handshake({ Origin: 'https://attacker.example' });
  const missingOrigin = await request('/socket.io/?EIO=4&transport=polling&t=securitytest-no-origin');

  assert.equal(allowed.status, 200);
  assert.match(allowed.body, /^0/);
  assert.equal(denied.status, 403);
  assert.equal(missingOrigin.status, 403);
});

test('uses a canonical forwarded IP from the trusted proxy for handshake quotas', async () => {
  const firstClientIp = '203.0.113.77';
  const responses = [];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    responses.push(await handshake({ 'X-Forwarded-For': firstClientIp }));
  }

  for (const response of responses.slice(0, 5)) {
    assert.equal(response.status, 200);
  }
  assert.equal(responses[5].status, 403);

  // A different canonical client IP must get its own quota. This also guards
  // against silently treating every trusted-proxy request as the proxy itself.
  const differentClient = await handshake({ 'X-Forwarded-For': '203.0.113.78' });
  assert.equal(differentClient.status, 200);
});

test('does not let multi-value forwarded headers bypass the handshake limit', async () => {
  const canonicalClientIp = '203.0.113.79';
  const responses = [];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    responses.push(await handshake({
      // A correctly configured trusted proxy overwrites this header with one
      // canonical client IP. Treating the attacker-controlled first value in
      // an appended chain as the client would give every request a new quota.
      'X-Forwarded-For': `198.51.100.${attempt + 1}, ${canonicalClientIp}`,
    }));
  }

  for (const response of responses.slice(0, 5)) {
    assert.equal(response.status, 200);
  }
  assert.equal(responses[5].status, 403);
});
