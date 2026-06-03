#!/usr/bin/env node
/* global console, fetch, process */
import assert from 'node:assert/strict';

const base = process.env.BASE_URL || process.env.JOSCOL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;

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
  const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ role, email: `${role}@joscol.local`, password: `${role}-demo` }) }, jar);
  assert.equal(result.response.status, 200, `${role} login should pass`);
  return jar;
}

async function main() {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.data.gps.publicExactCoordinates, false, 'public exact coordinates must stay disabled');

  const orderCreate = await request('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      customer: 'GPS Smoke',
      phone: '+240 555 000 222',
      pickup: 'Restaurante La Luna, Malabo Centro',
      dropoff: 'Hotel Anda China, Ela Nguema',
      item: 'Cena + bebidas',
      zone: 'Malabo Centro',
      priority: 'standard',
      notes: 'location smoke',
    }),
  });
  assert.equal(orderCreate.response.status, 201);
  const orderId = orderCreate.data.order.id;

  const dispatchJar = await login('dispatch');
  const assign = await request(`/api/orders/${orderId}/auto-assign`, { method: 'POST', body: JSON.stringify({}) }, dispatchJar);
  assert.equal(assign.response.status, 200);
  const assignedOrder = assign.data.orders.find((order) => order.id === orderId);
  assert.ok(assignedOrder.riderId, 'auto-assign should select a rider');

  const riderJar = await login('rider');
  const noConsent = await request(`/api/riders/${assignedOrder.riderId}/location`, {
    method: 'POST',
    body: JSON.stringify({ lat: 3.7524, lng: 8.7741, accuracy: 24, sharing: true }),
  }, riderJar);
  assert.equal(noConsent.response.status, 400, 'GPS sharing should require explicit consent');

  const ping = await request(`/api/riders/${assignedOrder.riderId}/location`, {
    method: 'POST',
    body: JSON.stringify({ lat: 3.7524, lng: 8.7741, accuracy: 24, sharing: true, consent: true }),
  }, riderJar);
  assert.equal(ping.response.status, 200);
  const pingRider = ping.data.riders.find((rider) => rider.id === assignedOrder.riderId);
  assert.equal(pingRider.location.sharing, true);
  assert.equal(pingRider.location.consent, true);

  const tracking = await request(`/api/track/${orderId}`);
  assert.equal(tracking.response.status, 200);
  assert.equal(tracking.data.order.riderLocation.sharing, true);
  assert.equal(tracking.data.order.riderLocation.freshness, 'fresh');
  assert.equal(typeof tracking.data.order.riderLocation.lat, 'number');
  assert.equal(tracking.data.order.riderLocation.lng, undefined, 'public tracking must not expose exact longitude');

  const stop = await request(`/api/riders/${assignedOrder.riderId}/location/stop`, { method: 'POST', body: JSON.stringify({}) }, riderJar);
  assert.equal(stop.response.status, 200, 'rider stop sharing should succeed');
  const stoppedTracking = await request(`/api/track/${orderId}`);
  assert.equal(stoppedTracking.data.order.riderLocation, null, 'public tracking should hide stopped GPS');

  const issue = await request(`/api/orders/${orderId}/exception`, { method: 'POST', body: JSON.stringify({}) }, riderJar);
  assert.equal(issue.response.status, 200);
  const issueOrder = issue.data.orders.find((order) => order.id === orderId);
  assert.equal(issueOrder.status, 'exception');

  console.log(JSON.stringify({ ok: true, base, orderId, riderId: assignedOrder.riderId }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
