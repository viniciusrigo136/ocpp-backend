// api.js — rotas REST para o sistema da Lovable consumir

const express = require('express');
const router = express.Router();
const store = require('./store');
const { sendCall } = require('./ocppHandler');

const API_TOKEN = process.env.API_SECRET_TOKEN;

function auth(req, res, next) {
  if (!API_TOKEN) return next();
  const token = req.headers['x-api-token'] || req.query.token;
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido ou ausente' });
  }
  next();
}

router.use(auth);

// ─── Health check ─────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Carregadores ─────────────────────────────────────────────────────────────
router.get('/chargers', (_req, res) => {
  res.json(store.getAllChargers());
});

router.get('/chargers/:id', (req, res) => {
  const charger = store.getCharger(req.params.id);
  if (!charger) return res.status(404).json({ error: 'Carregador não encontrado' });
  res.json(charger);
});

// ─── Sessões ──────────────────────────────────────────────────────────────────
router.get('/sessions', (req, res) => {
  const { chargePointId } = req.query;
  res.json(store.getAllSessions(chargePointId));
});

router.get('/sessions/:transactionId', (req, res) => {
  const session = store.getSession(req.params.transactionId);
  if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
  res.json(session);
});

// ─── Logs OCPP ────────────────────────────────────────────────────────────────
// GET /api/logs/:chargePointId?limit=50&eventType=connector.status
router.get('/logs/:chargePointId', (req, res) => {
  const { chargePointId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const eventType = req.query.eventType || null;
  const logs = store.getLogs(chargePointId, limit, eventType);
  res.json(logs);
});

// ─── Uptime ───────────────────────────────────────────────────────────────────
// GET /api/uptime/:chargePointId?from=2026-06-01&to=2026-06-15
router.get('/uptime/:chargePointId', (req, res) => {
  const { chargePointId } = req.params;
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const uptime = store.getUptimeStats(chargePointId, from, to);
  res.json(uptime);
});

// ─── Falhas ───────────────────────────────────────────────────────────────────
// GET /api/faults/:chargePointId?limit=200
router.get('/faults/:chargePointId', (req, res) => {
  const { chargePointId } = req.params;
  const limit = parseInt(req.query.limit) || 200;
  const faults = store.getFaults(chargePointId, limit);
  res.json(faults);
});

// ─── Comandos OCPP ────────────────────────────────────────────────────────────

// POST /api/chargers/:id/remote-start
router.post('/chargers/:id/remote-start', async (req, res) => {
  const { connectorId = 1, idTag = 'REMOTE' } = req.body;
  try {
    const result = await sendCall(req.params.id, 'RemoteStartTransaction', { connectorId, idTag });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/remote-stop
router.post('/chargers/:id/remote-stop', async (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) return res.status(400).json({ error: 'transactionId obrigatório' });
  try {
    const result = await sendCall(req.params.id, 'RemoteStopTransaction', { transactionId });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/reset
router.post('/chargers/:id/reset', async (req, res) => {
  const { type = 'Soft' } = req.body;
  try {
    const result = await sendCall(req.params.id, 'Reset', { type });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/unlock-connector
router.post('/chargers/:id/unlock-connector', async (req, res) => {
  const { connectorId = 1 } = req.body;
  try {
    const result = await sendCall(req.params.id, 'UnlockConnector', { connectorId });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/change-availability
router.post('/chargers/:id/change-availability', async (req, res) => {
  const { connectorId = 0, type = 'Operative' } = req.body;
  try {
    const result = await sendCall(req.params.id, 'ChangeAvailability', { connectorId, type });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/get-configuration
router.post('/chargers/:id/get-configuration', async (req, res) => {
  const { key } = req.body;
  try {
    const result = await sendCall(req.params.id, 'GetConfiguration', key ? { key } : {});
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/change-configuration
router.post('/chargers/:id/change-configuration', async (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key e value obrigatórios' });
  try {
    const result = await sendCall(req.params.id, 'ChangeConfiguration', { key, value: String(value) });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/trigger-message
// Body: { requestedMessage, connectorId }
// requestedMessage: BootNotification | StatusNotification | Heartbeat | MeterValues | DiagnosticsStatusNotification | FirmwareStatusNotification
router.post('/chargers/:id/trigger-message', async (req, res) => {
  const { requestedMessage = 'StatusNotification', connectorId } = req.body;
  const payload = { requestedMessage };
  if (connectorId !== undefined) payload.connectorId = connectorId;
  try {
    const result = await sendCall(req.params.id, 'TriggerMessage', payload);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/update-firmware
// Body: { location, retrieveDate, retries, retryInterval }
router.post('/chargers/:id/update-firmware', async (req, res) => {
  const { location, retrieveDate, retries = 3, retryInterval = 60 } = req.body;
  if (!location) return res.status(400).json({ error: 'location (URL do firmware) obrigatório' });
  try {
    const result = await sendCall(req.params.id, 'UpdateFirmware', {
      location,
      retrieveDate: retrieveDate || new Date().toISOString(),
      retries,
      retryInterval,
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/get-diagnostics
// Body: { location, startTime, stopTime, retries, retryInterval }
router.post('/chargers/:id/get-diagnostics', async (req, res) => {
  const { location, startTime, stopTime, retries = 3, retryInterval = 60 } = req.body;
  if (!location) return res.status(400).json({ error: 'location (URL de upload) obrigatório' });
  try {
    const result = await sendCall(req.params.id, 'GetDiagnostics', {
      location,
      startTime,
      stopTime,
      retries,
      retryInterval,
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/reserve-now
// Body: { connectorId, expiryDate, idTag, reservationId }
router.post('/chargers/:id/reserve-now', async (req, res) => {
  const { connectorId = 1, expiryDate, idTag, reservationId } = req.body;
  try {
    const result = await sendCall(req.params.id, 'ReserveNow', {
      connectorId,
      expiryDate: expiryDate || new Date(Date.now() + 30 * 60000).toISOString(),
      idTag: idTag || 'RESERVE',
      reservationId: reservationId || Date.now(),
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/cancel-reservation
// Body: { reservationId }
router.post('/chargers/:id/cancel-reservation', async (req, res) => {
  const { reservationId } = req.body;
  if (!reservationId) return res.status(400).json({ error: 'reservationId obrigatório' });
  try {
    const result = await sendCall(req.params.id, 'CancelReservation', { reservationId });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/send-local-list
// Body: { listVersion, localAuthorizationList, updateType }
router.post('/chargers/:id/send-local-list', async (req, res) => {
  const { listVersion = 1, localAuthorizationList = [], updateType = 'Full' } = req.body;
  try {
    const result = await sendCall(req.params.id, 'SendLocalList', {
      listVersion,
      localAuthorizationList,
      updateType,
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/clear-cache
router.post('/chargers/:id/clear-cache', async (req, res) => {
  try {
    const result = await sendCall(req.params.id, 'ClearCache', {});
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/chargers/:id/active-session
// Retorna a sessão ativa de um conector específico
router.get('/chargers/:id/active-session', (req, res) => {
  const { connectorId } = req.query;
  const sessions = store.getAllSessions(req.params.id);
  const active = sessions.filter(s => s.status === 'Active' &&
    (connectorId === undefined || s.connectorId === parseInt(connectorId)));
  res.json(active);
});

module.exports = router;
