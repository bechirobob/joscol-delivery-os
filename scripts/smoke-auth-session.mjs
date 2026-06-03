#!/usr/bin/env node
/* global console, fetch, process */
import assert from 'node:assert/strict';

const base = process.env.JOSCOL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
const demoPasswords = { dispatch: 'dispatch-demo', rider: 'rider-demo', ops: 'ops-demo' };

async function request(path, options = {}, jar = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (jar.cookie) headers.Cookie = jar.cookie;
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) jar.cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { response, data, jar };
}

async function login(role) {
  const jar = {};
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ role, email: `${role}@joscol.local`, password: demoPasswords[role] }),
  }, jar);
  assert.equal(result.response.status, 200, `${role} login should succeed`);
  assert.ok(jar.cookie?.startsWith('joscol_session='), `${role} login should set session cookie`);
  return jar;
}

async function main() {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200, 'health should pass');
  assert.equal(health.data.auth.sessionBacked, true, 'auth should be session-backed');
  assert.equal(health.data.storage.localOnlyFallback, true, 'local smoke should use JSON fallback only');
  assert.equal(health.data.notifications.corePersistenceBlocksOnSend, false, 'notifications must not block order persistence');
  assert.equal(health.data.payments.liveChargesEnabled, false, 'payments must not pretend live charges without env');

  const payment = await request('/api/payments/checkout', { method: 'POST', body: JSON.stringify({ orderId: 'JSC-2401' }) });
  assert.equal(payment.response.status, 503, 'unconfigured payment checkout should fail safely');

  const headerSpoof = await request('/api/state?role=ops', { headers: { 'X-JOSCOL-Role': 'ops' } });
  assert.equal(headerSpoof.data.publicOnly, true, 'header-only spoofing should fail closed unless explicitly enabled');

  const publicReset = await request('/api/reset', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(publicReset.response.status, 403, 'logged-out reset must be rejected');

  for (const role of ['dispatch', 'rider', 'ops']) {
    const jar = await login(role);
    const me = await request('/api/auth/me', {}, jar);
    assert.equal(me.data.authenticated, true, `${role} session should authenticate`);
    assert.equal(me.data.role, role, `${role} session should report role`);
    const state = await request('/api/state', {}, jar);
    assert.equal(state.response.status, 200, `${role} state should load with cookie`);
    assert.equal(state.data.role, role, `${role} state should be role-scoped`);
    const logout = await request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }, jar);
    assert.equal(logout.response.status, 200, `${role} logout should succeed`);
  }

  console.log(JSON.stringify({ ok: true, base, checked: ['login', 'session-cookie', 'logout', 'header-spoof-denied'] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
