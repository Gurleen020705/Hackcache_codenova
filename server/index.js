import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { departments } from '../src/data/departments.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, 'data');
const dbFile = path.join(dataDir, 'hospital-state.json');
// Keep the API on its own port so it does not collide with other local demos.
const port = Number(process.env.PORT || 3010);
const staffPin = process.env.STAFF_PIN || '2468';
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } });
const sessions = new Map();
let state;

const initialState = () => ({ patients: [], flags: [], statuses: {}, history: {}, lastId: 0, called: {} });
async function loadState() {
  await mkdir(dataDir, { recursive: true });
  try { state = { ...initialState(), ...JSON.parse(await readFile(dbFile, 'utf8')) }; }
  catch { state = initialState(); await persist(); }
}
async function persist() { await writeFile(dbFile, JSON.stringify(state, null, 2)); }
const cleanId = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
const byTime = (a, b) => a.created - b.created || a.id - b.id;
const tokenFor = (patient) => patient ? patient.token : '—';
function publicSnapshot(clientId = '') {
  const id = state.clientPatients?.[clientId];
  const own = state.patients.find((p) => p.id === id);
  const currentToken = Object.fromEntries(departments.map((d) => [d.id, tokenFor(state.patients.find((p) => p.id === state.called[d.id]))]));
  const queues = Object.fromEntries(departments.map((d) => {
    const waiting = state.patients.filter((p) => p.department === d.id && p.status === 'waiting').sort(byTime);
    const history = state.history[d.id] || [];
    const average = history.length ? history.slice(-10).reduce((sum, n) => sum + n, 0) / Math.min(10, history.length) : d.average;
    const ahead = own?.department === d.id ? Math.max(0, waiting.findIndex((p) => p.id === own.id)) : 0;
    const delay = Number(state.statuses[d.id]?.delay || 0);
    return [d.id, {
      waiting: waiting.length,
      nextTokens: waiting.slice(0, 6).map((patient) => patient.token),
      currentToken: currentToken[d.id],
      average,
      delay,
      ahead,
      waitMins: Math.ceil((ahead * average + delay) / 5) * 5,
      queueWaitMins: Math.ceil((waiting.length * average + delay) / 5) * 5,
    }];
  }));
  const patient = own ? { ...own, ahead: queues[own.department].ahead, waitMins: queues[own.department].waitMins } : null;
  return { patients: patient ? [patient] : [], flags: [], statuses: state.statuses, history: {}, called: {}, currentToken, queues, lastId: state.lastId, updatedAt: Date.now(), online: true };
}
function staffOnly(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) return res.status(401).json({ error: 'Staff PIN required.' });
  req.staffToken = token;
  next();
}
function publish() {
  io.emit('queue:changed', { updatedAt: Date.now() });
  io.to('staff').emit('staff:state', state);
}
app.use(express.json({ limit: '64kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, updatedAt: Date.now() }));
app.get('/api/public/state', (req, res) => res.json(publicSnapshot(cleanId(req.get('x-client-id')))));
app.get('/api/public/patient', async (req, res) => {
  const token = String(req.query.token || '').trim().toUpperCase();
  const clientId = cleanId(req.get('x-client-id'));
  const patient = state.patients.find((item) => item.token.toUpperCase() === token);
  if (!patient || !clientId) return res.status(404).json({ error: 'Token not found.' });
  state.clientPatients = { ...(state.clientPatients || {}), [clientId]: patient.id };
  await persist();
  res.json({ patient, snapshot: publicSnapshot(clientId) });
});
app.get('/api/public/patient/qr/:qrToken', async (req, res) => {
  const clientId = cleanId(req.get('x-client-id'));
  const patient = state.patients.find((item) => item.qrToken && item.qrToken === req.params.qrToken);
  if (!patient || !clientId) return res.status(404).json({ error: 'Slip QR not found.' });
  state.clientPatients = { ...(state.clientPatients || {}), [clientId]: patient.id };
  await persist();
  res.json({ patient, snapshot: publicSnapshot(clientId) });
});
app.get('/api/public/board', (_req, res) => res.json({ departments: departments.map((d) => {
  const current = state.patients.find((p) => p.id === state.called[d.id]);
  const waiting = state.patients.filter((p) => p.department === d.id && p.status === 'waiting').sort(byTime);
  return { id: d.id, currentToken: current?.token || '—', waiting: waiting.length, nextTokens: waiting.slice(0, 6).map((patient) => patient.token), status: state.statuses[d.id] || { state: 'available' } };
}), updatedAt: Date.now() }));
app.post('/api/staff/login', (req, res) => {
  if (String(req.body?.pin || '') !== staffPin) return res.status(401).json({ error: 'Incorrect staff PIN.' });
  const token = randomBytes(24).toString('base64url');
  sessions.set(token, { expires: Date.now() + 12 * 60 * 60 * 1000 });
  res.json({ token, state });
});
app.post('/api/staff/logout', staffOnly, (req, res) => { sessions.delete(req.staffToken); res.json({ ok: true }); });
app.get('/api/staff/state', staffOnly, (_req, res) => res.json(state));
app.post('/api/staff/state', staffOnly, async (req, res) => {
  const incoming = req.body?.state;
  if (!incoming || !Array.isArray(incoming.patients) || !Array.isArray(incoming.flags) || typeof incoming.statuses !== 'object') return res.status(400).json({ error: 'Invalid hospital state.' });
  state = { ...initialState(), ...incoming };
  await persist(); publish();
  res.json({ ok: true, state });
});
app.post('/api/patients', async (req, res) => {
  const clientId = cleanId(req.get('x-client-id'));
  const { name, age, gender, mobile, department } = req.body || {};
  const d = departments.find((item) => item.id === department);
  if (!clientId || !d || !String(name || '').trim()) return res.status(400).json({ error: 'Name and a valid department are required.' });
  const existingId = state.clientPatients?.[clientId];
  const existing = state.patients.find((p) => p.id === existingId && ['waiting', 'called'].includes(p.status));
  if (existing) return res.json({ patient: existing, snapshot: publicSnapshot(clientId) });
  const id = ++state.lastId;
  const patient = { id, qrToken: randomBytes(18).toString('base64url'), token: `${d.prefix}-${String(40 + id).padStart(3, '0')}`, name: String(name).trim().slice(0, 80), age: String(age || '').slice(0, 3), gender: String(gender || '').slice(0, 40), mobile: String(mobile || '').slice(0, 24), department: d.id, status: 'waiting', created: Date.now() };
  state.patients.push(patient);
  state.clientPatients = { ...(state.clientPatients || {}), [clientId]: id };
  await persist(); publish();
  res.status(201).json({ patient, snapshot: publicSnapshot(clientId) });
});
app.post('/api/urgent', async (req, res) => {
  const reason = String(req.body?.reason || 'Emergency assistance requested').slice(0, 120);
  const flag = { id: Date.now(), time: new Date().toLocaleTimeString(), seen: false, reason };
  state.flags = [flag, ...state.flags];
  await persist(); publish();
  res.status(201).json({ ok: true });
});
app.use(express.static(path.resolve(here, '../dist')));
app.get('*path', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.resolve(here, '../dist/index.html'));
});
io.on('connection', (socket) => {
  const auth = (token) => {
    const session = sessions.get(token);
    if (session && session.expires > Date.now()) { socket.join('staff'); socket.emit('staff:state', state); }
  };
  auth(socket.handshake.auth?.staffToken);
  socket.on('staff:auth', auth);
});
await loadState();
http.listen(port, '0.0.0.0', () => console.log(`OPD Saathi API and Socket.IO listening on http://0.0.0.0:${port}`));
