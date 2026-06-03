#!/usr/bin/env node
/* global console, fetch, process */
import assert from 'node:assert/strict';

const base = process.env.JOSCOL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
const passwords = { dispatch: 'dispatch-demo', rider: 'rider-demo', ops: 'ops-demo' };

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

async function login(role) {
  const jar = {};
  const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ role, email: `${role}@joscol.local`, password: passwords[role] }) }, jar);
  assert.equal(result.response.status, 200, `${role} login should pass`);
  return jar;
}

function textHasInternalLeak(value) {
  const text = JSON.stringify(value);
  return /\+240 555 110 217|\+240 555 144 808|\+240 222 993 401|\+240 555 320 774|actor|selectedOrderId|riders\s*":|orders\s*":/.test(text);
}

async function main() {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200, 'health should pass');
  assert.equal(health.data.ok, true, 'health ok should be true');
  assert.equal(health.data.storage.atomicWrites, true, 'storage should report atomic JSON writes');

  const publicState = await request('/api/state');
  assert.equal(publicState.response.status, 200, 'public state should be available');
  assert.equal(publicState.data.publicOnly, true, 'public state should be summary-only');
  assert.equal(publicState.data.orders, undefined, 'public state must not expose orders');
  assert.equal(publicState.data.riders, undefined, 'public state must not expose riders');

  const orderCreate = await request('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      customer: 'Role Smoke',
      phone: '+240 555 000 333',
      pickup: 'Restaurante La Luna, Malabo Centro',
      dropoff: 'Hotel Anda China, Ela Nguema',
      item: 'Cena + bebidas',
      zone: 'Malabo Centro',
      priority: 'standard',
      notes: 'role separation smoke',
      riderId: 'R-17',
      status: 'assigned',
      selectedOrderId: 'JSC-2401',
    }),
  });
  assert.equal(orderCreate.response.status, 201, 'public order create should succeed');
  const orderId = orderCreate.data.order.id;
  assert.ok(orderId?.startsWith('JSC-'), 'receipt should include JSC order ID');
  assert.equal(orderCreate.data.orders, undefined, 'order create must not return full order list');
  assert.equal(orderCreate.data.riders, undefined, 'order create must not return riders');
  assert.equal(orderCreate.data.order.rider, null, 'public cannot force rider assignment on create');

  const publicAssign = await request(`/api/orders/${orderId}/auto-assign`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(publicAssign.response.status, 403, 'public auto-assign must be rejected');

  const dispatchJar = await login('dispatch');
  const dispatchAssign = await request(`/api/orders/${orderId}/auto-assign`, { method: 'POST', body: JSON.stringify({}) }, dispatchJar);
  assert.equal(dispatchAssign.response.status, 200, 'dispatch auto-assign should succeed');
  const assignedOrder = dispatchAssign.data.orders.find((order) => order.id === orderId);
  assert.ok(assignedOrder.riderId, 'dispatch auto-assign should attach a rider');

  const riderJar = await login('rider');
  const riderState = await request('/api/state', {}, riderJar);
  assert.equal(riderState.response.status, 200, 'rider state should load');
  assert.ok(Array.isArray(riderState.data.orders), 'rider state should include assigned jobs');
  assert.equal(riderState.data.riders.some((rider) => rider.phone), false, 'rider state must not expose rider phone roster');

  const advance = await request(`/api/orders/${orderId}/advance`, { method: 'POST', body: JSON.stringify({}) }, riderJar);
  assert.equal(advance.response.status, 200, 'rider advance should succeed');

  const tracking = await request(`/api/track/${orderId}`);
  assert.equal(tracking.response.status, 200, 'public tracking should load');
  assert.equal(textHasInternalLeak(tracking.data.order), false, 'public tracking must not expose internal roles, full riders, or phone roster');
  assert.equal(tracking.data.order.rider?.phone, undefined, 'public tracking must not expose rider phone');
  assert.equal(tracking.data.order.riderId, undefined, 'public tracking must not expose riderId');

  const resetDenied = await request('/api/reset', { method: 'POST', body: JSON.stringify({}) }, dispatchJar);
  assert.equal(resetDenied.response.status, 403, 'dispatch reset must be rejected');

  console.log(JSON.stringify({ ok: true, base, orderId }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
