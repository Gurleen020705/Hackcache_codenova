import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { departments } from '../src/data/departments.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Load local secrets without adding a runtime dependency. Real deployments should set env vars directly.
const envFile = path.resolve(here, '../.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (match && !match[1].startsWith('#') && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
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
app.use(express.json({ limit: '8mb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, updatedAt: Date.now() }));
app.post('/api/voice/transcribe', async (req, res) => {
  const apiKey = process.env.GNANI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Gnani voice is not configured. Add GNANI_API_KEY to .env.' });
  const { audio, mimeType = 'audio/webm', language = 'en' } = req.body || {};
  if (typeof audio !== 'string' || audio.length > 7_000_000) return res.status(400).json({ error: 'Audio is missing or too large (maximum 30 seconds).' });
  const bytes = Buffer.from(audio, 'base64');
  if (!bytes.length) return res.status(400).json({ error: 'Audio recording is empty.' });
  const type = String(mimeType).toLowerCase();
  const extension = type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : type.includes('mp4') ? 'm4a' : type.includes('mpeg') ? 'mp3' : 'webm';
  try {
    const form = new FormData();
    form.append('audio_file', new Blob([bytes], { type }), `recording.${extension}`);
    form.append('model', 'prisma-v3.0');
    const languageCode = ({ en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', bn: 'bn-IN' })[language] || 'indic-auto';
    form.append('language_code', languageCode);
    const upstream = await fetch('https://api.vachana.ai/stt/v3', { method: 'POST', headers: { 'X-API-Key-ID': apiKey }, body: form, signal: AbortSignal.timeout(45000) });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(upstream.status).json({ error: result.message || result.error?.message || 'Gnani could not transcribe this recording.' });
    return res.json({ transcript: result.transcript || '', language: result.detected_language_code || languageCode });
  } catch (error) { return res.status(502).json({ error: error.name === 'TimeoutError' ? 'Gnani transcription timed out.' : 'Could not reach Gnani speech-to-text.' }); }
});
app.post('/api/voice/synthesize', async (req, res) => {
  const apiKey = process.env.GNANI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Gnani voice is not configured. Add GNANI_API_KEY to .env.' });
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Text is required and must be 2,000 characters or fewer.' });
  const language = ({ en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', bn: 'bn-IN' })[req.body?.language] || 'en-IN';
  try {
    const upstream = await fetch('https://api.vachana.ai/api/v1/tts/inference', {
      method: 'POST', headers: { 'X-API-Key-ID': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: 'Chetana', model: 'timbre-v3.0', language, audio_config: { encoding: 'linear_pcm', container: 'wav', num_channels: 1, sample_rate: 24000, sample_width: 2 } }),
      signal: AbortSignal.timeout(45000),
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Gnani could not synthesize this speech.' });
    res.set('Content-Type', upstream.headers.get('content-type') || 'audio/wav');
    res.set('Cache-Control', 'no-store');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) { return res.status(502).json({ error: error.name === 'TimeoutError' ? 'Gnani speech synthesis timed out.' : 'Could not reach Gnani text-to-speech.' }); }
});
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
