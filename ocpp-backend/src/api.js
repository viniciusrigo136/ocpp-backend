// api.js — rotas REST para o sistema da Lovable consumir

const express = require('express');
const router = express.Router();
const store = require('./store');
const { sendCall } = require('./ocppHandler');

// ─── Middleware de autenticação simples ───────────────────────────────────────
const API_TOKEN = process.env.API_SECRET_TOKEN;

function auth(req, res, next) {
  if (!API_TOKEN) return next(); // sem token configurado = aberto (só para dev)
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

// GET /api/chargers — lista todos os carregadores
router.get('/chargers', (_req, res) => {
  res.json(store.getAllChargers());
});

// GET /api/chargers/:id — detalhes de um carregador
router.get('/chargers/:id', (req, res) => {
  const charger = store.getCharger(req.params.id);
  if (!charger) return res.status(404).json({ error: 'Carregador não encontrado' });
  res.json(charger);
});

// ─── Sessões ──────────────────────────────────────────────────────────────────

// GET /api/sessions — todas as sessões (opcional: ?chargePointId=xxx)
router.get('/sessions', (req, res) => {
  const { chargePointId } = req.query;
  res.json(store.getAllSessions(chargePointId));
});

// GET /api/sessions/:transactionId — detalhes de uma sessão
router.get('/sessions/:transactionId', (req, res) => {
  const session = store.getSession(req.params.transactionId);
  if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
  res.json(session);
});

// ─── Comandos OCPP (enviados ao carregador) ───────────────────────────────────

// POST /api/chargers/:id/remote-start
// Body: { connectorId, idTag }
router.post('/chargers/:id/remote-start', async (req, res) => {
  const { connectorId = 1, idTag = 'REMOTE' } = req.body;
  try {
    const result = await sendCall(req.params.id, 'RemoteStartTransaction', {
      connectorId,
      idTag,
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/remote-stop
// Body: { transactionId }
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
// Body: { type } — "Soft" ou "Hard"
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
// Body: { connectorId }
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
// Body: { connectorId, type } — type: "Operative" ou "Inoperative"
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
  const { key } = req.body; // array de keys ou vazio para todos
  try {
    const result = await sendCall(req.params.id, 'GetConfiguration', key ? { key } : {});
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/chargers/:id/change-configuration
// Body: { key, value }
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

module.exports = router;
