#!/usr/bin/env node
/* global console, fetch, process */
import assert from 'node:assert/strict';

const base = process.env.JOSCOL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;

async function request(path, options = {}, jar = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (jar.cookie) headers.Cookie = jar.cookie;
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) jar.cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { response, data };
}

async function main() {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200, 'health should pass');

  const before = await request('/api/track/JSC-2401');
  assert.equal(before.response.status, 200, 'seed tracking should load');
  assert.equal(before.data.order.status, 'assigned', 'support smoke expects fresh seed state');

  const spoof = await request('/api/track/JSC-2401/support', {
    method: 'POST',
    body: JSON.stringify({ phoneSuffix: '9999', note: 'Rider has not arrived' }),
  });
  assert.equal(spoof.response.status, 403, 'wrong phone suffix must not open a support case');

  const shortNote = await request('/api/track/JSC-2401/support', {
    method: 'POST',
    body: JSON.stringify({ phoneSuffix: '220', note: 'late' }),
  });
  assert.equal(shortNote.response.status, 400, 'short support note must be rejected');

  const support = await request('/api/track/JSC-2401/support', {
    method: 'POST',
    body: JSON.stringify({ phoneSuffix: '220', note: 'Rider has not arrived at the pickup point' }),
  });
  assert.equal(support.response.status, 200, 'valid customer support request should be accepted');
  assert.equal(support.data.order.status, 'exception', 'customer support request should move order into exception state');
  assert.equal(support.data.order.phone, undefined, 'public support response must not expose customer phone');
  assert.equal(support.data.order.riderId, undefined, 'public support response must not expose internal riderId');

  const after = await request('/api/track/JSC-2401');
  assert.equal(after.data.order.status, 'exception', 'tracking should show support exception state');
  assert.ok(after.data.order.timeline.some((event) => /Customer requested support/.test(event.label)), 'tracking timeline should include customer support event');

  console.log(JSON.stringify({ ok: true, base, checked: ['phone-confirmation', 'note-validation', 'customer-support-exception'] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
