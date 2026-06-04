/* global fetch */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, copyFile, stat } from 'node:fs/promises';
import { existsSync, createReadStream, readdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const defaultHost = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
const HOST = process.env.HOST || defaultHost;
const ROOT = resolve(process.cwd());
const DIST = join(ROOT, 'dist');
const DATA_DIR = join(ROOT, 'data');
const STATE_FILE = process.env.JOSCOL_STATE_FILE || join(DATA_DIR, 'joscol-state.json');
const STORAGE_ADAPTER = process.env.JOSCOL_STORAGE_ADAPTER || 'json-file';
const SUPABASE_URL = process.env.JOSCOL_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.JOSCOL_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DATABASE_URL_CONFIGURED = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);
const SESSION_TTL_MS = Math.max(5 * 60_000, Number(process.env.JOSCOL_SESSION_TTL_MINUTES || 8 * 60) * 60_000);
const SESSION_COOKIE = 'joscol_session';
const LOCATION_STALE_MS = Math.max(60_000, Number(process.env.JOSCOL_GPS_STALE_SECONDS || 120) * 1000);
const LOCATION_RETENTION_MS = Math.max(60_000, Number(process.env.JOSCOL_GPS_RETENTION_MINUTES || 60) * 60_000);
const allowHeaderAuth = process.env.JOSCOL_ALLOW_HEADER_AUTH === 'true';
const demoLoginDisabled = process.env.JOSCOL_DISABLE_DEMO_LOGIN === 'true';
const sessionSecret = process.env.JOSCOL_SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'joscol-local-review-session-secret');
const isProduction = process.env.NODE_ENV === 'production';
const allowProductionReset = process.env.JOSCOL_ALLOW_PRODUCTION_RESET === 'true';
const allowProductionExport = process.env.JOSCOL_ALLOW_PRODUCTION_EXPORT === 'true';
const notificationConfig = {
  email: Boolean(process.env.JOSCOL_RESEND_API_KEY && process.env.JOSCOL_NOTIFY_EMAIL_TO),
  whatsapp: Boolean(process.env.JOSCOL_WHATSAPP_TOKEN && process.env.JOSCOL_WHATSAPP_PHONE_NUMBER_ID),
  sms: Boolean(process.env.JOSCOL_SMS_PROVIDER && process.env.JOSCOL_SMS_API_KEY),
};
const paymentConfig = {
  paystack: Boolean(process.env.JOSCOL_PAYSTACK_SECRET_KEY && process.env.JOSCOL_PUBLIC_URL),
};

const zones = ['Malabo Centro', 'Ela Nguema', 'Banapá', 'Sampaka', 'Sipopo', 'Rebola'];
const priorities = ['standard', 'urgent'];
const staffRoles = ['dispatch', 'rider', 'ops'];

const demoCredentials = {
  dispatch: { email: 'dispatch@joscol.local', password: 'dispatch-demo' },
  rider: { email: 'rider@joscol.local', password: 'rider-demo' },
  ops: { email: 'ops@joscol.local', password: 'ops-demo' },
};

let storageLock = Promise.resolve();

const seedRiders = [
  { id: 'R-17', name: 'Miguel Mba', phone: '+240 555 110 217', vehicle: 'Moto · caja térmica', zone: 'Malabo Centro', rating: 4.9, status: 'available', capacity: 3, load: 0, position: 18 },
  { id: 'R-24', name: 'Lucía Nsue', phone: '+240 555 144 808', vehicle: 'Moto · documentos', zone: 'Ela Nguema', rating: 4.8, status: 'assigned', capacity: 2, load: 1, position: 46 },
  { id: 'R-31', name: 'Daniel Obama', phone: '+240 222 993 401', vehicle: 'Coche · compras grandes', zone: 'Sipopo', rating: 4.7, status: 'available', capacity: 4, load: 0, position: 8 },
  { id: 'R-45', name: 'Raquel Esono', phone: '+240 555 320 774', vehicle: 'Moto · restaurantes', zone: 'Banapá', rating: 4.9, status: 'busy', capacity: 3, load: 2, position: 72 },
];

function seedState() {
  const orders = [
    makeOrder({ customer: 'Claudia N.', phone: '+240 555 283 220', pickup: 'Restaurante La Luna, Malabo Centro', dropoff: 'Hotel Anda China, Ela Nguema', item: 'Cena + bebidas', zone: 'Malabo Centro', priority: 'standard', notes: 'Cliente pide llamada al llegar.' }, 'JSC-2401', 'assigned', 'R-24'),
    makeOrder({ customer: 'Comercial Martínez', phone: '+240 222 100 500', pickup: 'Oficina Gepetrol', dropoff: 'Puerto de Malabo', item: 'Documentos urgentes', zone: 'Malabo Centro', priority: 'urgent', notes: 'Entrega antes de las 17:00.' }, 'JSC-2402', 'received'),
  ];
  return { orders, riders: seedRiders, selectedOrderId: orders[0].id, updatedAt: new Date().toISOString() };
}

async function readState() {
  if (STORAGE_ADAPTER === 'postgres') return readSupabaseState();
  if (STORAGE_ADAPTER !== 'json-file') throw httpError(503, `Storage adapter ${STORAGE_ADAPTER} is not configured in this build`);
  try {
    const text = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.orders) && Array.isArray(parsed.riders)) return parsed;
  } catch {
    // Missing or malformed state falls back to a fresh seed below.
  }
  const seeded = seedState();
  await saveState(seeded);
  return seeded;
}

async function saveState(state) {
  if (STORAGE_ADAPTER === 'postgres') return saveSupabaseState(state);
  if (STORAGE_ADAPTER !== 'json-file') throw httpError(503, `Storage adapter ${STORAGE_ADAPTER} is not configured in this build`);
  await mkdir(DATA_DIR, { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() };
  const backupFile = `${STATE_FILE}.bak`;
  const tempFile = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  if (existsSync(STATE_FILE)) {
    try { await copyFile(STATE_FILE, backupFile); } catch { /* best-effort backup */ }
  }
  await writeFile(tempFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(tempFile, STATE_FILE);
  return next;
}

function assertSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw httpError(503, 'Postgres storage requires JOSCOL_SUPABASE_URL and JOSCOL_SUPABASE_SERVICE_ROLE_KEY, or keep JOSCOL_STORAGE_ADAPTER=json-file for local review');
  }
}

async function supabaseRequest(path, options = {}) {
  assertSupabaseConfigured();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw httpError(response.status, typeof data === 'object' && data?.message ? data.message : `Supabase request failed: ${response.status}`);
  return data;
}

async function readSupabaseState() {
  const [orderRows, riderRows] = await Promise.all([
    supabaseRequest('joscol_orders?select=id,data,updated_at&order=updated_at.desc'),
    supabaseRequest('joscol_riders?select=id,data,updated_at&order=id.asc'),
  ]);
  if (!orderRows.length && !riderRows.length) {
    const seeded = seedState();
    return saveSupabaseState(seeded);
  }
  const orders = orderRows.map((row) => row.data).filter(Boolean);
  const riders = riderRows.map((row) => row.data).filter(Boolean);
  return {
    orders,
    riders,
    selectedOrderId: orders[0]?.id || '',
    updatedAt: [...orderRows, ...riderRows].map((row) => row.updated_at).sort().at(-1) || new Date().toISOString(),
  };
}

async function saveSupabaseState(state) {
  const next = { ...state, updatedAt: new Date().toISOString() };
  const orderRows = next.orders.map((order) => ({ id: order.id, data: order, status: order.status, rider_id: order.riderId || null, updated_at: next.updatedAt }));
  const riderRows = next.riders.map((rider) => ({ id: rider.id, data: rider, status: rider.status, zone: rider.zone, updated_at: next.updatedAt }));
  const eventRows = next.orders.flatMap((order) => order.timeline.map((event, index) => ({ order_id: order.id, event_index: index, actor: event.actor || null, label: event.label, data: event, created_at: event.at || next.updatedAt })));
  const locationRows = next.riders.filter((rider) => rider.location).map((rider) => ({ rider_id: rider.id, data: rider.location, sharing: Boolean(rider.location.sharing), updated_at: rider.location.updatedAt || next.updatedAt }));
  if (orderRows.length) await supabaseRequest('joscol_orders?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(orderRows) });
  if (riderRows.length) await supabaseRequest('joscol_riders?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(riderRows) });
  if (eventRows.length) await supabaseRequest('joscol_order_events?on_conflict=order_id,event_index', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(eventRows) });
  if (locationRows.length) await supabaseRequest('joscol_rider_locations?on_conflict=rider_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(locationRows) });
  return next;
}

async function mutate(mutator) {
  const operation = storageLock.then(async () => {
    const state = await readState();
    const next = await mutator(JSON.parse(JSON.stringify(state)));
    return saveState(next);
  });
  storageLock = operation.catch(() => undefined);
  return operation;
}

async function storageHealth() {
  const postgresConfigured = STORAGE_ADAPTER === 'postgres' && Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
  const configured = STORAGE_ADAPTER === 'json-file' || postgresConfigured;
  const stateBytes = await stat(STATE_FILE).then((details) => details.size).catch(() => 0);
  const backupBytes = await stat(`${STATE_FILE}.bak`).then((details) => details.size).catch(() => 0);
  return {
    adapter: STORAGE_ADAPTER,
    configured,
    provider: STORAGE_ADAPTER === 'postgres' ? 'supabase-postgrest' : 'local-json-file',
    path: STORAGE_ADAPTER === 'json-file' ? STATE_FILE : undefined,
    supabaseUrlConfigured: Boolean(SUPABASE_URL),
    supabaseServiceKeyConfigured: Boolean(SUPABASE_SERVICE_KEY),
    databaseUrlConfigured: DATABASE_URL_CONFIGURED,
    atomicWrites: STORAGE_ADAPTER === 'json-file',
    backups: STORAGE_ADAPTER === 'json-file',
    inProcessLock: STORAGE_ADAPTER === 'json-file',
    stateBytes,
    backupBytes,
    managedDbReady: postgresConfigured,
    localOnlyFallback: STORAGE_ADAPTER === 'json-file',
    handoff: postgresConfigured ? 'Supabase/Postgres adapter is configured. Apply supabase/migrations before production writes.' : 'For Render production, set JOSCOL_STORAGE_ADAPTER=postgres plus JOSCOL_SUPABASE_URL and JOSCOL_SUPABASE_SERVICE_ROLE_KEY, or mount a persistent volume and keep json-file explicitly local-only.',
  };
}

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000) throw httpError(413, 'Payload too large');
  }
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad shape');
    return parsed;
  } catch {
    throw httpError(400, 'Invalid JSON body');
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function clean(value, max = 160) {
  return String(value ?? '').split('').filter((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join('').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validateRider(input, existing = []) {
  const rider = {
    name: clean(input.name, 80),
    phone: clean(input.phone, 40),
    vehicle: clean(input.vehicle, 80),
    zone: clean(input.zone, 40),
    capacity: Math.max(1, Math.min(6, Number(input.capacity) || 1)),
  };
  if (!rider.name || !rider.phone || !rider.vehicle) throw httpError(400, 'Missing required rider information');
  if (!/^\+?\d[\d\s-]{6,}$/.test(rider.phone)) throw httpError(400, 'Rider phone/WhatsApp number looks invalid');
  if (!zones.includes(rider.zone)) throw httpError(400, 'Unknown rider zone');
  const max = existing.reduce((highest, candidate) => Math.max(highest, Number(String(candidate.id).replace(/\D/g, '')) || 0), 0);
  return { id: `R-${Math.max(50, max + 1)}`, ...rider, rating: 5, status: 'available', load: 0, position: 12 };
}

function validateOrder(input) {
  const order = {
    customer: clean(input.customer, 80),
    phone: clean(input.phone, 40),
    pickup: clean(input.pickup, 140),
    dropoff: clean(input.dropoff, 140),
    item: clean(input.item, 120),
    zone: clean(input.zone, 40),
    priority: clean(input.priority, 20),
    notes: clean(input.notes, 220),
  };
  if (!order.customer || !order.phone || !order.pickup || !order.dropoff || !order.item) throw httpError(400, 'Missing required order information');
  if (!/^\+?\d[\d\s-]{6,}$/.test(order.phone)) throw httpError(400, 'Phone/WhatsApp number looks invalid');
  if (!zones.includes(order.zone)) throw httpError(400, 'Unknown delivery zone');
  if (!priorities.includes(order.priority)) throw httpError(400, 'Unknown priority');
  return order;
}

function makeOrder(form, forcedId, forcedStatus = 'received', riderId) {
  const id = forcedId ?? `JSC-${Date.now().toString().slice(-6)}`;
  const order = {
    id,
    createdAt: new Date().toISOString(),
    customer: form.customer.trim(),
    phone: form.phone.trim(),
    pickup: form.pickup.trim(),
    dropoff: form.dropoff.trim(),
    item: form.item.trim(),
    zone: form.zone,
    priority: form.priority,
    notes: form.notes.trim(),
    price: priceFor(form.zone, form.item, form.priority),
    eta: etaFor(form.zone, forcedStatus),
    status: forcedStatus,
    riderId,
    timeline: [{ at: new Date().toISOString(), actor: 'customer', label: 'Order received from customer app' }],
  };
  return riderId ? addEvent(order, 'dispatch', `Rider assigned: ${riderId}`) : order;
}

function addEvent(order, actor, label) {
  return { ...order, timeline: [...order.timeline, { at: new Date().toISOString(), actor, label }] };
}

function priceFor(zone, item, priority) {
  const zoneFee = zone === 'Sipopo' ? 3600 : zone === 'Sampaka' || zone === 'Rebola' ? 3000 : zone === 'Banapá' ? 2400 : 1800;
  const itemFee = /compra|grande|mercado|market|large/i.test(item) ? 900 : /document|doc/i.test(item) ? 0 : 500;
  return zoneFee + itemFee + (priority === 'urgent' ? 700 : 0);
}

function etaFor(zone, status) {
  if (status === 'delivered') return 0;
  const base = zone === 'Sipopo' ? 32 : zone === 'Sampaka' || zone === 'Rebola' ? 26 : 18;
  return status === 'received' ? base : Math.max(8, base - 8);
}

function nextOrderId(orders) {
  const max = orders.reduce((highest, order) => Math.max(highest, Number(order.id.replace(/\D/g, '')) || 0), 2400);
  return `JSC-${max + 1}`;
}

function nextStatus(status) {
  if (status === 'received') return 'assigned';
  if (status === 'assigned') return 'pickup';
  if (status === 'pickup') return 'transit';
  if (status === 'transit') return 'delivered';
  return status;
}

function timelineLabel(status) {
  if (status === 'assigned') return 'Order accepted by dispatch';
  if (status === 'pickup') return 'Rider arrived at pickup';
  if (status === 'transit') return 'Package picked up and in transit';
  if (status === 'delivered') return 'Delivery confirmed and closed';
  return 'Order updated';
}

function scoreRider(order, rider) {
  if (rider.status === 'offline' || rider.load >= rider.capacity) return -1;
  const zoneScore = rider.zone === order.zone ? 60 : 20;
  const loadScore = Math.max(0, (rider.capacity - rider.load) * 12);
  const ratingScore = Math.round(rider.rating * 5);
  const priorityScore = order.priority === 'urgent' && rider.status === 'available' ? 12 : 0;
  return zoneScore + loadScore + ratingScore + priorityScore - Math.round(rider.position / 8);
}

function bestRiderFor(order, riders) {
  return riders
    .map((rider) => ({ rider, score: scoreRider(order, rider) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.rider;
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, entry) => {
    const [rawKey, ...parts] = entry.trim().split('=');
    if (rawKey) cookies[rawKey] = decodeURIComponent(parts.join('='));
    return cookies;
  }, {});
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value) {
  if (!sessionSecret) throw httpError(503, 'Staff sessions are not configured');
  return createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function verifySignature(value, signature) {
  if (!sessionSecret || !signature) return false;
  const expected = sign(value);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

function makeSession(role) {
  const payload = { role, exp: Date.now() + SESSION_TTL_MS, nonce: randomBytes(12).toString('base64url') };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function readSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!verifySignature(encoded, signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!staffRoles.includes(payload.role) || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieHeader(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

function clearCookieHeader() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function configuredCredential(role) {
  const upper = role.toUpperCase();
  const email = process.env[`JOSCOL_${upper}_EMAIL`];
  const hash = process.env[`JOSCOL_${upper}_PASSWORD_SHA256`];
  return email && hash ? { email, hash, source: 'env-hash' } : null;
}

function authHealth() {
  const envCredentialRoles = staffRoles.filter((role) => Boolean(configuredCredential(role)));
  const missingEnvCredentialRoles = staffRoles.filter((role) => !configuredCredential(role));
  return {
    sessionBacked: true,
    headerAuthEnabled: allowHeaderAuth,
    demoLoginEnabled: !demoLoginDisabled,
    demoKillSwitch: 'JOSCOL_DISABLE_DEMO_LOGIN=true',
    sessionSecretConfigured: Boolean(sessionSecret),
    roles: staffRoles,
    envCredentialRoles,
    missingEnvCredentialRoles,
    productionReady: !isProduction || (Boolean(sessionSecret) && demoLoginDisabled && missingEnvCredentialRoles.length === 0),
  };
}

function notificationHealth() {
  return {
    configured: notificationConfig,
    mode: Object.values(notificationConfig).some(Boolean) ? 'best-effort-provider-ready' : 'skipped-no-provider-env',
    corePersistenceBlocksOnSend: false,
  };
}

function paymentHealth() {
  return {
    configured: paymentConfig,
    mode: paymentConfig.paystack ? 'paystack-server-checkout-ready' : 'skipped-no-provider-env',
    liveChargesEnabled: paymentConfig.paystack,
  };
}

function skippedNotifications(order) {
  return {
    orderId: order.id,
    email: notificationConfig.email ? 'configured-not-sent-in-this-route' : 'skipped-missing-env',
    whatsapp: notificationConfig.whatsapp ? 'configured-not-sent-in-this-route' : 'skipped-missing-env',
    sms: notificationConfig.sms ? 'configured-not-sent-in-this-route' : 'skipped-missing-env',
  };
}

function verifyLogin({ role, email, password }) {
  const cleanRole = clean(role, 20).toLowerCase();
  if (!staffRoles.includes(cleanRole)) throw httpError(400, 'Unknown staff role');
  const normalizedEmail = clean(email, 120).toLowerCase();
  const candidatePassword = String(password ?? '');
  const configured = configuredCredential(cleanRole);
  if (configured) {
    if (safeEqualText(normalizedEmail, configured.email.toLowerCase()) && safeEqualText(sha256(candidatePassword), configured.hash.toLowerCase())) return { role: cleanRole, source: configured.source };
  }
  if (!demoLoginDisabled && demoCredentials[cleanRole]) {
    const demo = demoCredentials[cleanRole];
    if (safeEqualText(normalizedEmail, demo.email) && safeEqualText(candidatePassword, demo.password)) return { role: cleanRole, source: 'demo-review' };
  }
  throw httpError(401, 'Invalid staff credentials');
}

function requestRole(req, url) {
  const session = readSession(req);
  if (session?.role) return session.role;
  if (allowHeaderAuth) {
    const role = clean(req.headers['x-joscol-role'] || url.searchParams.get('role'), 20).toLowerCase();
    if (staffRoles.includes(role)) return role;
  }
  return 'customer';
}

function requireRole(role, allowed) {
  if (!allowed.includes(role)) throw httpError(403, 'This action is not available for this role');
}

function safeTimeline(order) {
  return order.timeline.map((event) => ({ at: event.at, label: event.label }));
}

function locationToMapPoint(location) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return null;
  const x = Math.max(10, Math.min(90, ((location.lng - 8.65) / 0.35) * 80 + 10));
  const y = Math.max(18, Math.min(82, 82 - (((location.lat - 3.68) / 0.14) * 64)));
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function safeRiderLocation(rider) {
  if (!rider?.location?.sharing) return null;
  const point = locationToMapPoint(rider.location);
  if (!point) return null;
  const ageMs = Date.now() - Date.parse(rider.location.updatedAt || 0);
  if (ageMs > LOCATION_RETENTION_MS) return null;
  return {
    sharing: true,
    updatedAt: rider.location.updatedAt,
    accuracy: rider.location.accuracy,
    freshness: ageMs > LOCATION_STALE_MS ? 'stale' : 'fresh',
    ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
    lat: Math.round(rider.location.lat * 1000) / 1000,
    mapX: point.x,
    mapY: point.y,
  };
}

function validateLocation(input) {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const accuracy = Math.max(0, Math.min(5000, Number(input.accuracy ?? 0) || 0));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw httpError(400, 'Location requires numeric lat/lng');
  if (lat < 3.3 || lat > 4.0 || lng < 8.3 || lng > 9.3) throw httpError(400, 'Location is outside the operating area');
  if (input.sharing !== false && input.consent !== true) throw httpError(400, 'Rider GPS sharing requires explicit consent');
  return { lat, lng, accuracy, sharing: input.sharing !== false, consent: input.consent === true, updatedAt: new Date().toISOString() };
}

function safeTracking(order, riders) {
  if (!order) return null;
  const rider = riders.find((candidate) => candidate.id === order.riderId);
  return {
    id: order.id,
    createdAt: order.createdAt,
    pickup: order.pickup,
    dropoff: order.dropoff,
    item: order.item,
    status: order.status,
    price: order.price,
    eta: order.eta,
    timeline: safeTimeline(order),
    rider: rider ? { name: rider.name.split(' ')[0], vehicle: rider.vehicle } : null,
    riderLocation: safeRiderLocation(rider),
  };
}

function stateForRole(state, role) {
  if (role === 'customer') {
    return {
      role,
      publicOnly: true,
      updatedAt: state.updatedAt,
      summary: {
        activeOrders: state.orders.filter((order) => order.status !== 'delivered').length,
        onlineRiders: state.riders.filter((rider) => rider.status !== 'offline').length,
        zones,
      },
    };
  }
  if (role === 'rider') {
    const assignedOrders = state.orders.filter((order) => order.riderId && order.status !== 'delivered');
    return {
      ...state,
      role,
      selectedOrderId: assignedOrders[0]?.id || state.selectedOrderId,
      orders: assignedOrders,
      riders: state.riders.map((rider) => ({ ...rider, phone: undefined })),
    };
  }
  return { ...state, role };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'JOSCOL Delivery OS', storage: await storageHealth(), auth: authHealth(), gps: { staleSeconds: Math.round(LOCATION_STALE_MS / 1000), retentionMinutes: Math.round(LOCATION_RETENTION_MS / 60_000), publicExactCoordinates: false }, notifications: notificationHealth(), payments: paymentHealth(), opsSafety: { productionResetEnabled: !isProduction || allowProductionReset, productionExportEnabled: !isProduction || allowProductionExport }, time: new Date().toISOString() });
    if (url.pathname === '/favicon.ico') { res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' }); return res.end(); }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const login = verifyLogin(await body(req));
      const token = makeSession(login.role);
      return json(res, 200, { ok: true, role: login.role, source: login.source, expiresInSeconds: Math.floor(SESSION_TTL_MS / 1000) }, { 'Set-Cookie': cookieHeader(token) });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookieHeader() });
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const session = readSession(req);
      return json(res, 200, { authenticated: Boolean(session), role: session?.role ?? null, expiresAt: session?.exp ? new Date(session.exp).toISOString() : null });
    }
    const role = requestRole(req, url);
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, stateForRole(await readState(), role));
    if (url.pathname === '/api/orders' && req.method === 'POST') {
      const input = validateOrder(await body(req));
      const state = await mutate((current) => {
        const order = makeOrder(input, nextOrderId(current.orders));
        current.orders = [order, ...current.orders];
        current.selectedOrderId = order.id;
        return current;
      });
      const order = state.orders.find((candidate) => candidate.id === state.selectedOrderId);
      return json(res, 201, { order: safeTracking(order, state.riders), notifications: skippedNotifications(order) });
    }
    if (url.pathname.startsWith('/api/orders/') && req.method === 'POST') {
      const [, , , orderId, action] = url.pathname.split('/');
      const payload = await body(req);
      const state = await mutate((current) => {
        const order = current.orders.find((candidate) => candidate.id === orderId);
        if (!order) throw httpError(404, 'Order not found');
        if (action === 'assign') {
          requireRole(role, ['dispatch', 'ops']);
          const rider = current.riders.find((candidate) => candidate.id === clean(payload.riderId, 20));
          if (!rider || rider.status === 'offline' || rider.load >= rider.capacity) throw httpError(400, 'Rider is not available');
          current.orders = current.orders.map((candidate) => candidate.id === orderId ? addEvent({ ...candidate, status: 'assigned', riderId: rider.id, eta: etaFor(candidate.zone, 'assigned') }, 'dispatch', `Rider assigned: ${rider.name}`) : candidate);
          current.riders = current.riders.map((candidate) => candidate.id === rider.id ? { ...candidate, status: 'assigned', load: Math.min(candidate.capacity, candidate.load + 1), position: Math.max(candidate.position, 24) } : candidate);
        } else if (action === 'auto-assign') {
          requireRole(role, ['dispatch', 'ops']);
          if (order.status === 'delivered' || order.status === 'exception') throw httpError(400, 'Order cannot be assigned');
          const rider = bestRiderFor(order, current.riders);
          if (!rider) throw httpError(400, 'No rider has capacity');
          current.orders = current.orders.map((candidate) => candidate.id === orderId ? addEvent({ ...candidate, status: 'assigned', riderId: rider.id, eta: etaFor(candidate.zone, 'assigned') }, 'dispatch', `Auto-assigned rider: ${rider.name}`) : candidate);
          current.riders = current.riders.map((candidate) => candidate.id === rider.id ? { ...candidate, status: 'assigned', load: Math.min(candidate.capacity, candidate.load + 1), position: Math.max(candidate.position, 24) } : candidate);
        } else if (action === 'advance') {
          requireRole(role, ['dispatch', 'rider', 'ops']);
          if (order.status === 'delivered' || order.status === 'exception') throw httpError(400, 'Order cannot be advanced');
          const next = nextStatus(order.status);
          current.orders = current.orders.map((candidate) => candidate.id === orderId ? addEvent({ ...candidate, status: next, eta: next === 'delivered' ? 0 : Math.max(4, candidate.eta - 7) }, next === 'pickup' || next === 'transit' || next === 'delivered' ? 'rider' : 'dispatch', timelineLabel(next)) : candidate);
          current.riders = current.riders.map((rider) => rider.id === order.riderId ? { ...rider, status: next === 'delivered' ? 'available' : 'busy', load: next === 'delivered' ? Math.max(0, rider.load - 1) : rider.load, position: next === 'delivered' ? 100 : Math.min(96, rider.position + 22) } : rider);
        } else if (action === 'exception') {
          requireRole(role, ['dispatch', 'rider', 'ops']);
          const actor = role === 'rider' ? 'rider' : 'dispatch';
          const label = role === 'rider' ? 'Rider flagged an issue for dispatch review' : 'Dispatch flagged an exception for support review';
          current.orders = current.orders.map((candidate) => candidate.id === orderId ? addEvent({ ...candidate, status: 'exception' }, actor, label) : candidate);
        } else {
          throw httpError(404, 'Unknown action');
        }
        current.selectedOrderId = orderId;
        return current;
      });
      return json(res, 200, state);
    }
    if (url.pathname === '/api/riders' && req.method === 'POST') {
      requireRole(role, ['ops']);
      const input = await body(req);
      const state = await mutate((current) => {
        const rider = validateRider(input, current.riders);
        current.riders = [...current.riders, rider];
        return current;
      });
      return json(res, 201, stateForRole(state, role));
    }
    if (url.pathname.startsWith('/api/riders/') && url.pathname.endsWith('/location') && req.method === 'POST') {
      requireRole(role, ['rider', 'ops']);
      const [, , , riderId] = url.pathname.split('/');
      const location = validateLocation(await body(req));
      const state = await mutate((current) => {
        const rider = current.riders.find((candidate) => candidate.id === riderId);
        if (!rider) throw httpError(404, 'Rider not found');
        current.riders = current.riders.map((candidate) => candidate.id === rider.id ? { ...candidate, location } : candidate);
        return current;
      });
      return json(res, 200, stateForRole(state, role));
    }
    if (url.pathname.startsWith('/api/riders/') && url.pathname.endsWith('/location/stop') && req.method === 'POST') {
      requireRole(role, ['rider', 'ops']);
      const [, , , riderId] = url.pathname.split('/');
      const state = await mutate((current) => {
        const rider = current.riders.find((candidate) => candidate.id === riderId);
        if (!rider) throw httpError(404, 'Rider not found');
        current.riders = current.riders.map((candidate) => candidate.id === rider.id ? { ...candidate, location: { ...(candidate.location ?? {}), sharing: false, updatedAt: new Date().toISOString() } } : candidate);
        return current;
      });
      return json(res, 200, stateForRole(state, role));
    }
    if (url.pathname.startsWith('/api/track/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').pop() || '').trim().toLowerCase();
      const state = await readState();
      return json(res, 200, { order: safeTracking(state.orders.find((order) => order.id.toLowerCase() === id), state.riders) });
    }
    if (url.pathname === '/api/payments/checkout' && req.method === 'POST') {
      const payload = await body(req);
      const orderId = clean(payload.orderId, 40);
      if (!paymentConfig.paystack) return json(res, 503, { error: 'Payment checkout is not configured', provider: 'paystack', requiredEnv: ['JOSCOL_PAYSTACK_SECRET_KEY', 'JOSCOL_PUBLIC_URL'], liveChargesEnabled: false });
      return json(res, 503, { error: 'Payment provider wrapper is configured but live checkout dispatch is intentionally disabled until provider smoke is completed', orderId, liveChargesEnabled: false });
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      requireRole(role, ['ops']);
      if (isProduction && !allowProductionReset) throw httpError(403, 'Production reset requires JOSCOL_ALLOW_PRODUCTION_RESET=true');
      return json(res, 200, stateForRole(await saveState(seedState()), role));
    }
    if (url.pathname === '/api/export' && req.method === 'GET') {
      requireRole(role, ['ops']);
      if (isProduction && !allowProductionExport) throw httpError(403, 'Production export requires JOSCOL_ALLOW_PRODUCTION_EXPORT=true');
      return json(res, 200, await readState());
    }
    return serveStatic(url.pathname, res);
  } catch (error) {
    return json(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
  }
}

function currentIndexAsset(extension) {
  try {
    return readdirSync(join(DIST, 'assets'))
      .filter((name) => name.startsWith('index-') && name.endsWith(extension))
      .sort()
      .at(-1);
  } catch {
    return null;
  }
}

function cacheHeaders(filePath) {
  const ext = extname(filePath);
  if (filePath.endsWith('/sw.js')) return { 'Cache-Control': 'no-store' };
  if (ext === '.html') return { 'Cache-Control': 'no-store' };
  if (filePath.includes('/assets/')) return { 'Cache-Control': 'public, max-age=31536000, immutable' };
  return { 'Cache-Control': 'public, max-age=300' };
}

function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let filePath = normalize(join(DIST, requested));
  if (!filePath.startsWith(DIST)) return json(res, 404, { error: 'Not found' });

  if (!existsSync(filePath) && pathname.startsWith('/assets/index-')) {
    const extension = extname(pathname);
    const currentAsset = ['.js', '.css'].includes(extension) ? currentIndexAsset(extension) : null;
    if (currentAsset) filePath = join(DIST, 'assets', currentAsset);
  }

  if (!existsSync(filePath) && pathname.startsWith('/assets/')) return json(res, 404, { error: 'Asset not found' });
  if (!existsSync(filePath) && !pathname.startsWith('/api/')) filePath = join(DIST, 'index.html');
  if (!existsSync(filePath)) return json(res, 404, { error: 'Not found' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8', '.ico': 'image/x-icon' };
  res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', ...cacheHeaders(filePath) });
  createReadStream(filePath).pipe(res);
}

createServer(route).listen(PORT, HOST, () => {
  console.log(`JOSCOL Delivery OS API listening on http://${HOST}:${PORT}`);
});
