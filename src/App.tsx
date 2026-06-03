import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import joscolLogo from './assets/joscol-logo.png';
import './styles.css';

type Locale = 'es' | 'en';
type Workspace = 'customer' | 'track' | 'dispatch' | 'rider' | 'ops' | 'rides';
type StaffRole = 'dispatch' | 'rider' | 'ops';
type AppRoute = 'customer' | 'staff';
type OrderStatus = 'received' | 'assigned' | 'pickup' | 'transit' | 'delivered' | 'exception';
type RiderStatus = 'available' | 'assigned' | 'busy' | 'offline';
type Priority = 'standard' | 'urgent';

type RiderLocation = {
  lat?: number;
  lng?: number;
  accuracy?: number;
  updatedAt?: string;
  sharing?: boolean;
  mapX?: number;
  mapY?: number;
  freshness?: 'fresh' | 'stale';
  ageSeconds?: number;
};

type Rider = {
  id: string;
  name: string;
  phone?: string;
  vehicle: string;
  zone: string;
  rating: number;
  status: RiderStatus;
  capacity: number;
  load: number;
  position: number;
  location?: RiderLocation;
};

type TimelineEvent = {
  at: string;
  actor?: 'customer' | 'dispatch' | 'rider' | 'system';
  label: string;
};

type Order = {
  id: string;
  createdAt: string;
  customer?: string;
  phone?: string;
  pickup: string;
  dropoff: string;
  item: string;
  zone?: string;
  priority?: Priority;
  notes?: string;
  price: number;
  eta: number;
  status: OrderStatus;
  riderId?: string;
  rider?: { name: string; vehicle: string } | null;
  riderLocation?: RiderLocation | null;
  timeline: TimelineEvent[];
};

type AppState = {
  orders: Order[];
  riders: Rider[];
  selectedOrderId: string;
  updatedAt?: string;
};

type OrderForm = {
  customer: string;
  phone: string;
  pickup: string;
  dropoff: string;
  item: string;
  zone: string;
  priority: Priority;
  notes: string;
};

type LoginForm = { role: StaffRole; email: string; password: string };

const zones = ['Malabo Centro', 'Ela Nguema', 'Banapá', 'Sampaka', 'Sipopo', 'Rebola'];
const emptyState: AppState = { orders: [], riders: [], selectedOrderId: '' };

const copy = {
  es: {
    brand: 'JOSCOL', product: 'Delivery OS',
    nav: { customer: 'Pedir', track: 'Track', dispatch: 'Dispatch', rider: 'Rider', ops: 'Admin', rides: 'Rides' },
    eyebrow: 'Malabo', title: 'Entrega en minutos.',
    subtitle: '',
    primary: 'Nuevo pedido', secondary: 'Seguir pedido', activeOrders: 'Activos', avgEta: 'ETA', onlineRiders: 'Riders', revenue: 'XAF',
    backend: 'Backend activo', local: 'Rol separado', orderForm: 'Nuevo pedido', tracking: 'Tracking cliente', dispatch: 'Control de despacho', rider: 'Rider app', ops: 'Operación', future: 'Futuro',
  },
  en: {
    brand: 'JOSCOL', product: 'Delivery OS',
    nav: { customer: 'Order', track: 'Track', dispatch: 'Dispatch', rider: 'Rider', ops: 'Admin', rides: 'Rides' },
    eyebrow: 'Malabo', title: 'Delivery in minutes.',
    subtitle: '',
    primary: 'New order', secondary: 'Track order', activeOrders: 'Active', avgEta: 'ETA', onlineRiders: 'Riders', revenue: 'XAF',
    backend: 'Backend live', local: 'Separated roles', orderForm: 'New order', tracking: 'Customer tracking', dispatch: 'Dispatch control', rider: 'Rider app', ops: 'Operations', future: 'Future',
  },
};

const statusText: Record<Locale, Record<OrderStatus, string>> = {
  es: { received: 'Recibido', assigned: 'Asignado', pickup: 'Recogida', transit: 'En camino', delivered: 'Entregado', exception: 'Incidencia' },
  en: { received: 'Received', assigned: 'Assigned', pickup: 'Pickup', transit: 'In transit', delivered: 'Delivered', exception: 'Exception' },
};

const riderStatusText: Record<Locale, Record<RiderStatus, string>> = {
  es: { available: 'Libre', assigned: 'Asignado', busy: 'Ocupado', offline: 'Offline' },
  en: { available: 'Free', assigned: 'Assigned', busy: 'Busy', offline: 'Offline' },
};

const workspaceIcons: Record<Workspace, ReactNode> = {
  customer: <DeliveryIcon />, track: <PinIcon />, dispatch: <GridIcon />, rider: <MotorcycleIcon />, ops: <GaugeIcon />, rides: <CarIcon />,
};

const roleWorkspaces: Record<StaffRole, Workspace[]> = {
  dispatch: ['dispatch'],
  rider: ['rider'],
  ops: ['ops', 'dispatch', 'rider', 'rides'],
};

const staffCredentialHints: Record<StaffRole, { label: string; email: string; password: string }> = {
  dispatch: { label: 'Dispatch', email: 'dispatch@joscol.local', password: 'dispatch-demo' },
  rider: { label: 'Rider', email: 'rider@joscol.local', password: 'rider-demo' },
  ops: { label: 'Admin control', email: 'ops@joscol.local', password: 'ops-demo' },
};

function initialRoute(): AppRoute {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/staff')) return 'staff';
  return 'customer';
}

function App() {
  const [locale, setLocale] = useState<Locale>('es');
  const [appRoute, setAppRoute] = useState<AppRoute>(initialRoute);
  const [customerTab, setCustomerTab] = useState<'customer' | 'track'>('customer');
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [loginForm, setLoginForm] = useState<LoginForm>({ role: 'dispatch', email: 'dispatch@joscol.local', password: '' });
  const [workspace, setWorkspace] = useState<Workspace>('customer');
  const [state, setState] = useState<AppState>(emptyState);
  const [trackingId, setTrackingId] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<Order | undefined>();
  const [message, setMessage] = useState('Ready.');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<OrderForm>({ customer: '', phone: '+240 ', pickup: '', dropoff: '', item: '', zone: 'Malabo Centro', priority: 'standard', notes: '' });

  const { orders, riders, selectedOrderId } = state;
  const t = copy[locale];
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  const selectedRider = riders.find((rider) => rider.id === selectedOrder?.riderId);
  const quote = useMemo(() => priceFor(form.zone, form.item, form.priority), [form.zone, form.item, form.priority]);
  const openOrders = orders.filter((order) => order.status !== 'delivered').length;
  const averageEta = Math.round(orders.reduce((sum, order) => sum + order.eta, 0) / Math.max(orders.length, 1));
  const revenue = orders.reduce((sum, order) => sum + order.price, 0);
  const visibleStaffWorkspaces = staffRole ? roleWorkspaces[staffRole] : [];

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const syncRoute = () => setAppRoute(window.location.pathname.startsWith('/staff') ? 'staff' : 'customer');
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  function navigateApp(route: AppRoute) {
    const path = route === 'staff' ? '/staff' : '/';
    window.history.pushState({}, '', path);
    setAppRoute(route);
  }

  const api = useCallback(async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { ...headers, ...(options?.headers ?? {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data as T;
  }, []);

  const refreshState = useCallback(async function refreshState(roleOverride?: StaffRole) {
    const role = roleOverride ?? staffRole;
    if (!role) return;
    try {
      const next = await api<AppState>('/api/state');
      setState(next);
      setMessage(`${copy[locale].backend} · ${role.toUpperCase()} ${copy[locale].local}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load backend state.');
    }
  }, [api, locale, staffRole]);

  async function enterStaff(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const login = await api<{ role: StaffRole; source: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify(loginForm) });
      navigateApp('staff');
      setStaffRole(login.role);
      setWorkspace(login.role === 'ops' ? 'ops' : login.role);
      setMessage(`Session active · ${login.role.toUpperCase()} · ${login.source}`);
      await refreshState(login.role);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Staff login failed.');
    } finally {
      setBusy(false);
    }
  }

  function exitStaff() {
    void api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => undefined);
    setStaffRole(null);
    setWorkspace('customer');
    setState(emptyState);
    navigateApp('customer');
    setMessage('Returned to customer app. Staff data hidden.');
  }

  async function createOrder(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ order: Order }>('/api/orders', { method: 'POST', body: JSON.stringify(form) });
      setTrackedOrder(result.order);
      setTrackingId(result.order.id);
      setCustomerTab('track');
      setMessage(`${result.order.id} created. Customer tracking is ready.`);
      setForm({ customer: '', phone: '+240 ', pickup: '', dropoff: '', item: '', zone: 'Malabo Centro', priority: 'standard', notes: '' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create order.');
    } finally {
      setBusy(false);
    }
  }

  async function lookupTracking() {
    if (!trackingId.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ order: Order | null }>(`/api/track/${encodeURIComponent(trackingId.trim())}`);
      setTrackedOrder(result.order ?? undefined);
      setMessage(result.order ? `${result.order.id} tracking loaded.` : 'No matching order yet.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Tracking lookup failed.');
    } finally {
      setBusy(false);
    }
  }

  async function mutate(path: string, body?: unknown, success?: (next: AppState) => string) {
    setBusy(true);
    try {
      const next = await api<AppState>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
      setState(next);
      setMessage(success ? success(next) : 'Updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  function assignRider(orderId: string, riderId: string) { void mutate(`/api/orders/${orderId}/assign`, { riderId }, () => `${orderId} assigned.`); }
  function autoAssign(orderId: string) { void mutate(`/api/orders/${orderId}/auto-assign`, {}, () => `${orderId} auto-assigned.`); }
  function advanceOrder(orderId: string) { void mutate(`/api/orders/${orderId}/advance`, {}, (next) => `${orderId} moved to ${statusText[locale][next.orders.find((candidate) => candidate.id === orderId)?.status ?? 'received']}.`); }
  function markException(orderId: string) { void mutate(`/api/orders/${orderId}/exception`, {}, () => `${orderId} flagged for support review.`); }
  async function updateRiderLocation(riderId: string, payload: { lat: number; lng: number; accuracy?: number; sharing?: boolean }) {
    const next = await api<AppState>(`/api/riders/${riderId}/location`, { method: 'POST', body: JSON.stringify({ ...payload, consent: true }) });
    setState(next);
    setMessage(payload.sharing === false ? `${riderId} location sharing stopped.` : `${riderId} GPS ping shared.`);
  }
  function demoRiderLocation(riderId: string) {
    const jitter = Date.now() % 1000 / 100000;
    void updateRiderLocation(riderId, { lat: 3.7524 + jitter, lng: 8.7741 + jitter, accuracy: 28, sharing: true });
  }
  function shareRiderLocation(riderId: string) {
    if (!navigator.geolocation) return demoRiderLocation(riderId);
    navigator.geolocation.getCurrentPosition(
      (position) => void updateRiderLocation(riderId, { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, sharing: true }),
      () => demoRiderLocation(riderId),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 20000 },
    );
  }
  function stopRiderLocation(riderId: string) { void api<AppState>(`/api/riders/${riderId}/location/stop`, { method: 'POST', body: JSON.stringify({}) }).then((next) => { setState(next); setMessage(`${riderId} GPS sharing stopped.`); }).catch((error) => setMessage(error instanceof Error ? error.message : 'Could not stop GPS sharing.')); }
  function resetSystem() { void mutate('/api/reset', {}, () => 'Operational backend state reset to seed data.'); }
  async function exportState() {
    const data = await api<AppState>('/api/export');
    await navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
    setMessage('Backend operations snapshot copied to clipboard.');
  }

  return (
    <main id="top" className={staffRole ? 'staff-shell' : 'customer-shell'}>
      <header className="app-topbar">
        <a className="brand" href={appRoute === 'staff' ? '/staff' : '#top'} onClick={(event) => { if (appRoute === 'staff') { event.preventDefault(); navigateApp('staff'); } }} aria-label="JOSCOL Delivery OS home"><img src={joscolLogo} alt="JOSCOL" /><small>{staffRole ? `${staffCredentialHints[staffRole].label} workspace` : appRoute === 'staff' ? 'Staff login' : t.product}</small></a>
        <div className="top-actions">
          {appRoute === 'staff' ? <button className="ghost" onClick={staffRole ? exitStaff : () => navigateApp('customer')} type="button">{locale === 'es' ? 'Cliente' : 'Customer'}</button> : <button className="ghost staff-link" onClick={() => navigateApp('staff')} type="button">Staff</button>}
          <button className="locale-toggle" onClick={() => setLocale(locale === 'es' ? 'en' : 'es')} type="button">{locale === 'es' ? 'EN' : 'ES'}</button>
        </div>
      </header>

      {appRoute === 'customer' && !staffRole && <CustomerShell locale={locale} customerTab={customerTab} setCustomerTab={setCustomerTab} form={form} setForm={setForm} quote={quote} createOrder={createOrder} trackingId={trackingId} setTrackingId={setTrackingId} trackedOrder={trackedOrder} lookupTracking={lookupTracking} busy={busy} />}

      {appRoute === 'staff' && !staffRole && <StaffLoginPage locale={locale} loginForm={loginForm} setLoginForm={setLoginForm} openStaff={enterStaff} busy={busy} />}

      {appRoute === 'staff' && staffRole && <>
        <nav className="workspace-rail" aria-label="Staff workspaces">
          {visibleStaffWorkspaces.map((id) => <button key={id} className={workspace === id ? 'active' : ''} onClick={() => setWorkspace(id)} type="button">{workspaceIcons[id]}<span>{t.nav[id]}</span></button>)}
        </nav>
        <section className="staff-command-head">
          <div><p className="eyebrow">{staffCredentialHints[staffRole].label.toUpperCase()} · role scoped</p><h1>{staffRole === 'dispatch' ? (locale === 'es' ? 'Cola, asignación y excepciones.' : 'Queue, assignment, exceptions.') : staffRole === 'rider' ? (locale === 'es' ? 'Rutas asignadas y estados.' : 'Assigned routes and status updates.') : (locale === 'es' ? 'Admin control: pedidos, riders, incidencias.' : 'Admin control: orders, riders, exceptions.')}</h1></div>
          {selectedOrder && <TrackingSheet locale={locale} order={selectedOrder} rider={selectedRider} compact />}
        </section>
        <section className="ops-strip" aria-label="Current operations summary">
          <Metric label={t.activeOrders} value={String(openOrders)} /><Metric label={t.avgEta} value={`${averageEta} min`} /><Metric label={t.onlineRiders} value={String(riders.filter((rider) => rider.status !== 'offline').length)} /><Metric label={t.revenue} value={revenue.toLocaleString('es-GQ')} />
        </section>
        {message && <p className="status-message" role="status" aria-live="polite">{busy ? 'Working...' : message}</p>}
        <section className="module-shell">
          {workspace === 'dispatch' && <DispatchModule locale={locale} orders={orders} riders={riders} selectedOrderId={selectedOrderId} setSelectedOrderId={(id) => setState((current) => ({ ...current, selectedOrderId: id }))} assignRider={assignRider} autoAssign={autoAssign} advanceOrder={advanceOrder} markException={markException} busy={busy} />}
          {workspace === 'rider' && <RiderModule locale={locale} orders={orders} riders={riders} advanceOrder={advanceOrder} markException={markException} shareRiderLocation={shareRiderLocation} demoRiderLocation={demoRiderLocation} stopRiderLocation={stopRiderLocation} busy={busy} />}
          {workspace === 'ops' && <OperationsModule locale={locale} orders={orders} riders={riders} resetSystem={resetSystem} exportState={exportState} refreshState={refreshState} busy={busy} />}
          {workspace === 'rides' && <RideHailingModule locale={locale} />}
        </section>
      </>}

      {appRoute === 'customer' && !staffRole && message && <p className="status-message" role="status" aria-live="polite">{busy ? 'Working...' : message}</p>}
      {appRoute === 'staff' && !staffRole && message && <p className="status-message" role="status" aria-live="polite">{busy ? 'Working...' : message}</p>}
    </main>
  );
}

function CustomerShell({ locale, customerTab, setCustomerTab, form, setForm, quote, createOrder, trackingId, setTrackingId, trackedOrder, lookupTracking, busy }: { locale: Locale; customerTab: 'customer' | 'track'; setCustomerTab: (tab: 'customer' | 'track') => void; form: OrderForm; setForm: (next: OrderForm) => void; quote: number; createOrder: (event: FormEvent) => void; trackingId: string; setTrackingId: (id: string) => void; trackedOrder?: Order; lookupTracking: () => Promise<void>; busy: boolean }) {
  const t = copy[locale];
  return <>
    <section className="command-hero customer-hero">
      <div className="hero-copy-block"><p className="eyebrow">{t.eyebrow}</p><h1>{t.title}</h1><div className="hero-actions"><button onClick={() => setCustomerTab('customer')} type="button">{t.primary}</button><button className="ghost" onClick={() => setCustomerTab('track')} type="button">{t.secondary}</button></div></div>
      <div className="customer-flow-card compact-card"><strong>JSC</strong><span>15–30 min</span><span>XAF</span></div>
    </section>
    <nav className="customer-tabs" aria-label="Customer actions"><button className={customerTab === 'customer' ? 'active' : ''} onClick={() => setCustomerTab('customer')} type="button"><DeliveryIcon />{t.nav.customer}</button><button className={customerTab === 'track' ? 'active' : ''} onClick={() => setCustomerTab('track')} type="button"><PinIcon />{t.nav.track}</button></nav>
    <section className="module-shell">
      {customerTab === 'customer' && <CustomerModule form={form} setForm={setForm} quote={quote} createOrder={createOrder} locale={locale} busy={busy} />}
      {customerTab === 'track' && <TrackingModule locale={locale} trackingId={trackingId} setTrackingId={setTrackingId} order={trackedOrder} lookupTracking={lookupTracking} busy={busy} />}
    </section>
  </>;
}

function StaffLoginPage({ locale, loginForm, setLoginForm, openStaff, busy }: { locale: Locale; loginForm: LoginForm; setLoginForm: (next: LoginForm) => void; openStaff: (event: FormEvent) => void; busy: boolean }) {
  return <section className="staff-login-page" id="staff-login"><div className="staff-login-hero"><p className="eyebrow">{locale === 'es' ? 'Acceso staff' : 'Staff access'}</p><h1>{locale === 'es' ? 'Login separado para despacho, riders y admin.' : 'Separate login for dispatch, riders, and admin.'}</h1><p>{locale === 'es' ? 'Los clientes siguen en la app de pedidos. El equipo entra aquí para monitorizar cola, movimientos y controles.' : 'Customers stay on the ordering app. The team enters here for queue, movement, and control monitoring.'}</p></div><form onSubmit={openStaff} className="staff-entry staff-login"><strong>{locale === 'es' ? 'Abrir workspace' : 'Open workspace'}</strong><div className="staff-login-grid"><label>Role<select value={loginForm.role} onChange={(e) => { const role = e.target.value as StaffRole; setLoginForm({ ...loginForm, role, email: staffCredentialHints[role].email }); }}><option value="dispatch">Dispatch</option><option value="rider">Rider</option><option value="ops">Admin control</option></select></label><label>Email<input autoComplete="username" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} /></label><label>Password<input autoComplete="current-password" type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder={staffCredentialHints[loginForm.role].password} /></label></div><button disabled={busy || !loginForm.email || !loginForm.password} type="submit">{locale === 'es' ? 'Entrar' : 'Log in'} · {staffCredentialHints[loginForm.role].label}</button></form><div className="credential-grid" aria-label="Demo review credentials">{(Object.keys(staffCredentialHints) as StaffRole[]).map((role) => <button className="credential-card ghost" key={role} type="button" onClick={() => setLoginForm({ role, email: staffCredentialHints[role].email, password: staffCredentialHints[role].password })}><strong>{staffCredentialHints[role].label}</strong><span>{staffCredentialHints[role].email}</span><code>{staffCredentialHints[role].password}</code></button>)}</div></section>;
}

function CustomerModule({ form, setForm, quote, createOrder, locale, busy }: { form: OrderForm; setForm: (next: OrderForm) => void; quote: number; createOrder: (event: FormEvent) => void; locale: Locale; busy: boolean }) {
  return <div className="workbench customer-workbench"><form className="order-sheet" onSubmit={createOrder}><p className="eyebrow">{copy[locale].orderForm}</p><h2>{locale === 'es' ? '¿Qué se entrega?' : 'What needs delivery?'}</h2><div className="route-inputs"><label>{locale === 'es' ? 'Recoger' : 'Pickup'}<input required value={form.pickup} onChange={(e) => setForm({ ...form, pickup: e.target.value })} placeholder="Restaurante / tienda / oficina" /></label><span aria-hidden="true" /><label>{locale === 'es' ? 'Entregar' : 'Dropoff'}<input required value={form.dropoff} onChange={(e) => setForm({ ...form, dropoff: e.target.value })} placeholder="Dirección de entrega" /></label></div><div className="field-grid compact-fields"><label>{locale === 'es' ? 'Cliente' : 'Customer'}<input autoComplete="name" required value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Claudia Nsue" /></label><label>WhatsApp<input autoComplete="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+240 555 000 000" /></label><label>{locale === 'es' ? 'Pedido' : 'Item'}<input required value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="Comida, documentos, compra..." /></label><label>{locale === 'es' ? 'Zona' : 'Zone'}<select value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select></label><label>{locale === 'es' ? 'Prioridad' : 'Priority'}<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}><option value="standard">Standard</option><option value="urgent">Urgent</option></select></label><label>{locale === 'es' ? 'Notas' : 'Notes'}<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Pago, referencia, instrucciones" /></label></div><div className="bottom-action"><span>{locale === 'es' ? 'Precio' : 'Price'}<strong>{quote.toLocaleString('es-GQ')} XAF</strong></span><button disabled={busy} type="submit">{locale === 'es' ? 'Enviar' : 'Send'}</button></div></form><div className="quick-jutsus"><button className="ghost" type="button" onClick={() => setForm({ ...form, pickup: 'Restaurante La Luna', item: 'Cena', zone: 'Malabo Centro' })}>La Luna</button><button className="ghost" type="button" onClick={() => setForm({ ...form, pickup: 'Supermercado Martínez', item: 'Compra grande', zone: 'Banapá', priority: 'urgent' })}>Market</button><button className="ghost" type="button" onClick={() => setForm({ ...form, pickup: 'Oficina Gepetrol', item: 'Documentos urgentes', zone: 'Malabo Centro', priority: 'urgent' })}>Docs</button></div></div>;
}

function TrackingModule({ locale, trackingId, setTrackingId, order, lookupTracking, busy }: { locale: Locale; trackingId: string; setTrackingId: (id: string) => void; order?: Order; lookupTracking: () => Promise<void>; busy: boolean }) {
  return <div className="workbench split-workbench"><div className="order-sheet"><p className="eyebrow">{copy[locale].tracking}</p><h2>{locale === 'es' ? 'Buscar por ID' : 'Search by ID'}</h2><label>{locale === 'es' ? 'ID de pedido' : 'Order ID'}<input value={trackingId} onChange={(e) => setTrackingId(e.target.value)} placeholder="JSC-2401" /></label><div className="hero-actions"><button disabled={busy || !trackingId.trim()} onClick={() => void lookupTracking()} type="button">{locale === 'es' ? 'Consultar' : 'Look up'}</button></div>{order ? <TrackingSheet locale={locale} order={order} /> : <p className="empty-state">JSC-2401</p>}</div><TimelinePanel locale={locale} order={order} /></div>;
}

function DispatchModule({ locale, orders, riders, selectedOrderId, setSelectedOrderId, assignRider, autoAssign, advanceOrder, markException, busy }: { locale: Locale; orders: Order[]; riders: Rider[]; selectedOrderId: string; setSelectedOrderId: (id: string) => void; assignRider: (orderId: string, riderId: string) => void; autoAssign: (orderId: string) => void; advanceOrder: (orderId: string) => void; markException: (orderId: string) => void; busy: boolean }) {
  const selected = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  return <div className="dispatch-board"><div className="queue-pane"><p className="eyebrow">{copy[locale].dispatch}</p><h2>{locale === 'es' ? 'Cola' : 'Queue'}</h2>{orders.map((order) => <button key={order.id} className={`queue-row ${selected?.id === order.id ? 'selected' : ''}`} onClick={() => setSelectedOrderId(order.id)} type="button"><span className="queue-main"><strong>{order.id}</strong><small>{order.pickup}</small></span><span className={`status ${order.status}`}>{statusText[locale][order.status]}</span></button>)}</div>{selected && <div className="dispatch-pane"><TrackingSheet locale={locale} order={selected} rider={riders.find((rider) => rider.id === selected.riderId)} /><div className="rider-lane">{riders.map((rider) => <article key={rider.id} className="rider-line"><div><strong>{rider.name}</strong><span>{rider.zone} · {rider.vehicle}</span></div><span className={`status ${rider.status}`}>{riderStatusText[locale][rider.status]} · {rider.load}/{rider.capacity}</span><button onClick={() => assignRider(selected.id, rider.id)} disabled={busy || rider.status === 'offline' || rider.load >= rider.capacity} type="button">{locale === 'es' ? 'Asignar' : 'Assign'}</button></article>)}</div><div className="bottom-action"><button onClick={() => autoAssign(selected.id)} disabled={busy || selected.status === 'delivered' || selected.status === 'exception'} type="button">Auto-assign</button><button className="ghost" onClick={() => advanceOrder(selected.id)} disabled={busy || selected.status === 'delivered' || selected.status === 'exception'} type="button">{locale === 'es' ? 'Avanzar' : 'Advance'}</button><button className="ghost" onClick={() => markException(selected.id)} disabled={busy || selected.status === 'delivered'} type="button">{locale === 'es' ? 'Incidencia' : 'Exception'}</button></div></div>}</div>;
}

function RiderModule({ locale, orders, riders, advanceOrder, markException, shareRiderLocation, demoRiderLocation, stopRiderLocation, busy }: { locale: Locale; orders: Order[]; riders: Rider[]; advanceOrder: (orderId: string) => void; markException: (orderId: string) => void; shareRiderLocation: (riderId: string) => void; demoRiderLocation: (riderId: string) => void; stopRiderLocation: (riderId: string) => void; busy: boolean }) {
  const active = orders.filter((order) => order.riderId && order.status !== 'delivered');
  return <div className="workbench split-workbench"><div className="phone-surface"><p className="eyebrow">{copy[locale].rider}</p><h2>{locale === 'es' ? 'Rutas asignadas' : 'Assigned routes'}</h2>{active.length === 0 && <p className="empty-state">{locale === 'es' ? 'No hay entregas asignadas.' : 'No assigned deliveries.'}</p>}{active.map((order) => {
    const rider = riders.find((candidate) => candidate.id === order.riderId);
    const live = rider?.location?.sharing;
    return <article className="job-sheet" key={order.id}><span className="badge">{order.id}</span><strong>{order.item}</strong><p>{order.pickup} → {order.dropoff}</p><small>{rider?.name ?? 'Rider'} · ETA {order.eta} min · GPS {live ? 'live' : 'off'}</small><TrackingSheet locale={locale} order={order} rider={rider} compact /><div className="jutsu-actions"><button disabled={busy} onClick={() => advanceOrder(order.id)} type="button">{locale === 'es' ? 'Actualizar etapa' : 'Update stage'}</button><button className="ghost" disabled={busy || !rider} onClick={() => rider && shareRiderLocation(rider.id)} type="button">{locale === 'es' ? 'Compartir GPS' : 'Share GPS'}</button><button className="ghost" disabled={busy || !rider} onClick={() => rider && demoRiderLocation(rider.id)} type="button">Demo ping</button><button className="ghost" disabled={busy || !rider} onClick={() => rider && stopRiderLocation(rider.id)} type="button">{locale === 'es' ? 'Parar GPS' : 'Stop GPS'}</button><button className="danger" disabled={busy || order.status === 'exception'} onClick={() => markException(order.id)} type="button">{locale === 'es' ? 'Reportar incidencia' : 'Report issue'}</button></div></article>;
  })}</div><div className="route-brief dark"><p className="eyebrow">Jutsus</p><h2>{locale === 'es' ? 'Rider controls' : 'Rider controls'}</h2><ol><li><strong>Stage</strong><span>{locale === 'es' ? 'avanza pedido' : 'advance job'}</span></li><li><strong>GPS</strong><span>{locale === 'es' ? 'comparte / detiene' : 'share / stop'}</span></li><li><strong>Issue</strong><span>{locale === 'es' ? 'alerta despacho' : 'alert dispatch'}</span></li></ol></div></div>;
}

function OperationsModule({ locale, orders, riders, resetSystem, exportState, refreshState, busy }: { locale: Locale; orders: Order[]; riders: Rider[]; resetSystem: () => void; exportState: () => void; refreshState: () => Promise<void>; busy: boolean }) {
  const exceptions = orders.filter((order) => order.status === 'exception');
  const incoming = orders.filter((order) => order.status !== 'delivered');
  const delivered = orders.filter((order) => order.status === 'delivered').length;
  return <div className="admin-control-board"><section className="admin-panel"><p className="eyebrow">{locale === 'es' ? 'Incoming orders' : 'Incoming orders'}</p><h2>{locale === 'es' ? 'Cola en vivo' : 'Live queue'}</h2><div className="admin-list">{incoming.map((order) => <article key={order.id} className="admin-row"><div><strong>{order.id}</strong><span>{order.pickup} → {order.dropoff}</span></div><span className={`status ${order.status}`}>{statusText[locale][order.status]}</span><b>{order.eta} min</b></article>)}{incoming.length === 0 && <p className="empty-state">{locale === 'es' ? 'Sin pedidos activos.' : 'No active orders.'}</p>}</div></section><section className="admin-panel"><p className="eyebrow">{locale === 'es' ? 'Rider movements' : 'Rider movements'}</p><h2>{locale === 'es' ? 'Movimiento riders' : 'Rider movement'}</h2><div className="admin-list">{riders.map((rider) => <article key={rider.id} className="admin-row"><div><strong>{rider.name}</strong><span>{rider.zone} · pos {rider.position}% · load {rider.load}/{rider.capacity}</span></div><span className={`status ${rider.status}`}>{riderStatusText[locale][rider.status]}</span><b>{rider.location?.sharing ? 'GPS' : 'No GPS'}</b></article>)}</div></section><section className="admin-panel admin-actions"><p className="eyebrow">Admin control</p><h2>{locale === 'es' ? 'Salud y controles' : 'Health and controls'}</h2><div className="ops-list"><Metric label={locale === 'es' ? 'Entregados' : 'Delivered'} value={String(delivered)} /><Metric label={locale === 'es' ? 'Incidencias' : 'Exceptions'} value={String(exceptions.length)} /><Metric label={locale === 'es' ? 'Capacidad' : 'Capacity'} value={`${riders.reduce((sum, rider) => sum + rider.load, 0)}/${riders.reduce((sum, rider) => sum + rider.capacity, 0)}`} /><Metric label={locale === 'es' ? 'Zonas' : 'Zones'} value={String(new Set(riders.map((rider) => rider.zone)).size)} /></div><div className="bottom-action"><button disabled={busy} onClick={exportState} type="button">{locale === 'es' ? 'Exportar' : 'Export'}</button><button className="ghost" disabled={busy} onClick={() => void refreshState()} type="button">Refresh</button><button className="danger" disabled={busy} onClick={resetSystem} type="button">Reset</button></div></section></div>;
}

function RideHailingModule({ locale }: { locale: Locale }) { return <div className="workbench split-workbench"><div className="order-sheet"><p className="eyebrow">{copy[locale].future}</p><h2>Ride</h2><div className="ops-list"><Metric label="ETA" value="Phase 2" /><Metric label="Fleet" value="Shared" /></div></div><div className="route-brief dark"><ol><li><strong>Delivery</strong><span>Now</span></li><li><strong>Rides</strong><span>Next</span></li></ol></div></div>; }

type MapPoint = { label: string; x: number; y: number };

type RouteMap = {
  pickup: MapPoint;
  dropoff: MapPoint;
  rider: MapPoint;
  progress: number;
};

const zoneAnchors: Record<string, MapPoint> = {
  'Malabo Centro': { label: 'Malabo Centro', x: 32, y: 48 },
  'Ela Nguema': { label: 'Ela Nguema', x: 58, y: 42 },
  'Banapá': { label: 'Banapá', x: 45, y: 64 },
  'Sampaka': { label: 'Sampaka', x: 76, y: 63 },
  'Sipopo': { label: 'Sipopo', x: 84, y: 30 },
  'Rebola': { label: 'Rebola', x: 22, y: 70 },
};

function placePoint(label: string, fallbackZone?: string): MapPoint {
  const text = label.toLowerCase();
  const zone = zones.find((candidate) => text.includes(candidate.toLowerCase())) ?? fallbackZone ?? 'Malabo Centro';
  const anchor = zoneAnchors[zone] ?? zoneAnchors['Malabo Centro'];
  const hash = Array.from(label).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const jitterX = ((hash % 11) - 5) * 1.2;
  const jitterY = (((hash >> 2) % 9) - 4) * 1.1;
  return { label, x: Math.max(10, Math.min(90, anchor.x + jitterX)), y: Math.max(18, Math.min(82, anchor.y + jitterY)) };
}

function routeProgress(order: Order, rider?: Rider) {
  if (order.status === 'delivered') return 100;
  if (rider) return Math.max(8, Math.min(92, rider.position));
  if (order.status === 'received') return 8;
  if (order.status === 'assigned') return 26;
  if (order.status === 'pickup') return 48;
  if (order.status === 'transit') return 72;
  return 35;
}

function routeMapFor(order: Order, rider?: Rider): RouteMap {
  const pickup = placePoint(order.pickup, order.zone);
  const dropoff = placePoint(order.dropoff, order.zone);
  const progress = routeProgress(order, rider);
  const liveLocation = rider?.location?.sharing ? rider.location : order.riderLocation?.sharing ? order.riderLocation : undefined;
  return {
    pickup,
    dropoff,
    progress,
    rider: {
      label: rider?.name ?? order.rider?.name ?? 'Rider',
      x: typeof liveLocation?.mapX === 'number' ? liveLocation.mapX : pickup.x + ((dropoff.x - pickup.x) * progress / 100),
      y: typeof liveLocation?.mapY === 'number' ? liveLocation.mapY : pickup.y + ((dropoff.y - pickup.y) * progress / 100),
    },
  };
}

function DeliveryMap({ locale, order, rider }: { locale: Locale; order: Order; rider?: Rider }) {
  const map = routeMapFor(order, rider);
  const liveLocation = rider?.location?.sharing ? rider.location : order.riderLocation?.sharing ? order.riderLocation : undefined;
  const curveMidY = Math.min(map.pickup.y, map.dropoff.y) - 16;
  const path = `M ${map.pickup.x} ${map.pickup.y} Q ${(map.pickup.x + map.dropoff.x) / 2} ${curveMidY} ${map.dropoff.x} ${map.dropoff.y}`;
  return <div className={`delivery-map ${liveLocation ? 'is-live' : ''}`} aria-label={locale === 'es' ? 'Mapa de seguimiento en app' : 'In-app tracking map'}>
    <svg viewBox="0 0 100 100" role="img" aria-label={`${order.pickup} to ${order.dropoff}`}>
      <defs><linearGradient id={`route-${order.id}`} x1="0" x2="1"><stop offset="0" stopColor="#c62026" /><stop offset="1" stopColor="#f5821f" /></linearGradient></defs>
      <path className="map-grid" d="M10 22H90M10 42H90M10 62H90M10 82H90M20 14V88M40 14V88M60 14V88M80 14V88" />
      <path className="route-shadow" d={path} />
      <path className="route-path" d={path} stroke={`url(#route-${order.id})`} />
      <circle className="pickup-pin" cx={map.pickup.x} cy={map.pickup.y} r="4.6" />
      <circle className="dropoff-pin" cx={map.dropoff.x} cy={map.dropoff.y} r="4.6" />
      <circle className="rider-pin" cx={map.rider.x} cy={map.rider.y} r="5.4" />
    </svg>
    <div className="map-legend"><span><b className="pickup-dot" />{locale === 'es' ? 'Recogida' : 'Pickup'}</span><span><b className="rider-dot" />Rider · {liveLocation ? `GPS ${liveLocation.freshness ?? 'fresh'}` : `${Math.round(map.progress)}%`}</span><span><b className="dropoff-dot" />{locale === 'es' ? 'Entrega' : 'Dropoff'}</span></div>
    <p>{liveLocation?.updatedAt ? `${locale === 'es' ? 'Último GPS' : 'Last GPS'} · ${new Date(liveLocation.updatedAt).toLocaleTimeString(locale === 'es' ? 'es-GQ' : 'en-US')} · ${liveLocation.ageSeconds ?? 0}s · ${locale === 'es' ? 'posición aproximada para clientes' : 'approximate customer position'}` : locale === 'es' ? 'Seguimiento dentro de la app. GPS real se activa con consentimiento del rider.' : 'In-app tracking. Live GPS activates with rider consent.'}</p>
  </div>;
}

function TrackingSheet({ locale, order, rider, compact = false }: { locale: Locale; order?: Order; rider?: Rider; compact?: boolean }) {
  if (!order) return <div className="tracking-sheet"><p className="empty-state">No orders yet.</p></div>;
  const orderRider = rider ? `${rider.name} · ${rider.vehicle}` : order.rider ? `${order.rider.name} · ${order.rider.vehicle}` : locale === 'es' ? 'Pendiente' : 'Pending';
  const progress = routeProgress(order, rider);
  return <article className={`tracking-sheet ${compact ? 'compact' : ''}`}><div className="tracking-head"><span className="badge">{order.id}</span><span className={`status ${order.status}`}>{statusText[locale][order.status]}</span></div><DeliveryMap locale={locale} order={order} rider={rider} /><div className="route-line" aria-label={`Route progress ${progress}%`}><span style={{ width: `${progress}%` }} /></div><div className="route-facts"><p><strong>{locale === 'es' ? 'Origen' : 'Pickup'}:</strong> {order.pickup}</p><p><strong>{locale === 'es' ? 'Destino' : 'Dropoff'}:</strong> {order.dropoff}</p><p><strong>ETA:</strong> {order.eta} min · {order.price.toLocaleString('es-GQ')} XAF</p><p><strong>Rider:</strong> {orderRider}</p></div><div className="action-row">{order.phone && <a href={`https://wa.me/${order.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}</div></article>;
}

function TimelinePanel({ locale, order }: { locale: Locale; order?: Order }) { return <div className="order-sheet timeline-panel"><p className="eyebrow">Timeline</p><h2>{order ? order.id : locale === 'es' ? 'Sin pedido' : 'No order'}</h2><ol className="timeline">{order?.timeline.map((event, index) => <li key={`${event.at}-${index}`}><strong>{event.label}</strong><span>{event.actor ? `${event.actor} · ` : ''}{new Date(event.at).toLocaleString(locale === 'es' ? 'es-GQ' : 'en-US')}</span></li>)}</ol></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><strong>{value}</strong><span>{label}</span></div>; }
function IconShell({ children }: { children: ReactNode }) { return <svg aria-hidden="true" className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>; }
function DeliveryIcon() { return <IconShell><path d="M4 16h9" /><path d="M14 16h2.7a2 2 0 0 0 1.7-.9l1.6-2.4V9h-4l-2-3H7a2 2 0 0 0-2 2v8" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /><path d="M8 10h4" /></IconShell>; }
function MotorcycleIcon() { return <IconShell><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M8.5 17h4l2.2-5H11" /><path d="M13 12l-2-3h3l2 3h3" /><path d="M5 14l2-4h2" /></IconShell>; }
function PinIcon() { return <IconShell><path d="M12 21s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></IconShell>; }
function GridIcon() { return <IconShell><path d="M4 4h6v6H4z" /><path d="M14 4h6v6h-6z" /><path d="M4 14h6v6H4z" /><path d="M14 14h6v6h-6z" /></IconShell>; }
function GaugeIcon() { return <IconShell><path d="M5 19a8 8 0 1 1 14 0" /><path d="m12 15 4-5" /><path d="M8 19h8" /></IconShell>; }
function CarIcon() { return <IconShell><path d="M5 16h14" /><path d="m7 16 1.4-5h7.2L17 16" /><circle cx="8" cy="18" r="1.5" /><circle cx="16" cy="18" r="1.5" /><path d="M9 11V8h6v3" /></IconShell>; }
function priceFor(zone: string, item: string, priority: Priority) { const zoneFee = zone === 'Sipopo' ? 3600 : zone === 'Sampaka' || zone === 'Rebola' ? 3000 : zone === 'Banapá' ? 2400 : 1800; const itemFee = /compra|grande|mercado|market|large/i.test(item) ? 900 : /document|doc/i.test(item) ? 0 : 500; return zoneFee + itemFee + (priority === 'urgent' ? 700 : 0); }
export default App;

