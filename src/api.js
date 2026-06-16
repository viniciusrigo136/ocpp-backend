// api.js — rotas REST completas (backend OCPP + persistência local)

const express = require('express');
const router = express.Router();
const store = require('./store');
const { sendCall } = require('./ocppHandler');
const db = require('./db-persist');

const API_TOKEN = process.env.API_SECRET_TOKEN;

function auth(req, res, next) {
  if (!API_TOKEN) return next();
  const token = req.headers['x-api-token'] || req.query.token;
  if (token !== API_TOKEN) return res.status(401).json({ error: 'Token inválido ou ausente' });
  next();
}
router.use(auth);

// ─── Health ───────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Carregadores ─────────────────────────────────────────────────────────────
router.get('/chargers', (_req, res) => res.json(store.getAllChargers()));
router.get('/chargers/:id', (req, res) => {
  const c = store.getCharger(req.params.id);
  if (!c) return res.status(404).json({ error: 'Carregador não encontrado' });
  res.json(c);
});

// ─── Sessões ──────────────────────────────────────────────────────────────────
router.get('/sessions', (req, res) => res.json(store.getAllSessions(req.query.chargePointId)));
router.get('/sessions/:transactionId', (req, res) => {
  const s = store.getSession(req.params.transactionId);
  if (!s) return res.status(404).json({ error: 'Sessão não encontrada' });
  res.json(s);
});

// ─── Logs ─────────────────────────────────────────────────────────────────────
router.get('/logs/:chargePointId', (req, res) => {
  res.json(store.getLogs(req.params.chargePointId, parseInt(req.query.limit) || 50, req.query.eventType || null));
});

// ─── Uptime ───────────────────────────────────────────────────────────────────
router.get('/uptime/:chargePointId', (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7*24*60*60*1000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  res.json(store.getUptimeStats(req.params.chargePointId, from, to));
});

// ─── Falhas ───────────────────────────────────────────────────────────────────
router.get('/faults/:chargePointId', (req, res) => {
  res.json(store.getFaults(req.params.chargePointId, parseInt(req.query.limit) || 200));
});

// ─── Manutenção ───────────────────────────────────────────────────────────────
router.get('/maintenance/:id/plans', (req, res) => res.json(db.getMaintenancePlans(req.params.id)));
router.post('/maintenance/:id/plans', (req, res) => res.json(db.addMaintenancePlan(req.params.id, req.body)));
router.put('/maintenance/:id/plans/:planId', (req, res) => {
  const p = db.updateMaintenancePlan(req.params.id, req.params.planId, req.body);
  if (!p) return res.status(404).json({ error: 'Plano não encontrado' });
  res.json(p);
});
router.delete('/maintenance/:id/plans/:planId', (req, res) => {
  if (!db.deleteMaintenancePlan(req.params.id, req.params.planId)) return res.status(404).json({ error: 'Plano não encontrado' });
  res.json({ success: true });
});
router.get('/maintenance/:id/records', (req, res) => res.json(db.getMaintenanceRecords(req.params.id)));
router.post('/maintenance/:id/records', (req, res) => res.json(db.addMaintenanceRecord(req.params.id, req.body)));

// ─── Notificações ─────────────────────────────────────────────────────────────
router.get('/notifications/:id', (req, res) => res.json(db.getNotifications(req.params.id)));
router.post('/notifications/:id', (req, res) => res.json(db.saveNotifications(req.params.id, req.body.notifications)));

// ─── Parâmetros ───────────────────────────────────────────────────────────────
router.get('/params/:id', (req, res) => res.json(db.getParams(req.params.id)));
router.post('/params/:id', (req, res) => res.json(db.saveParams(req.params.id, req.body)));

// ─── Custos de Energia ────────────────────────────────────────────────────────
router.get('/energy-costs/:id', (req, res) => res.json(db.getEnergyCosts(req.params.id)));
router.post('/energy-costs/:id', (req, res) => res.json(db.saveEnergyCost(req.params.id, req.body)));

// ─── Regras de Preço ──────────────────────────────────────────────────────────
router.get('/price-rules/:id', (req, res) => res.json(db.getPriceRules(req.params.id)));
router.post('/price-rules/:id', (req, res) => res.json(db.addPriceRule(req.params.id, req.body)));
router.put('/price-rules/:id/:ruleId', (req, res) => {
  const r = db.updatePriceRule(req.params.id, req.params.ruleId, req.body);
  if (!r) return res.status(404).json({ error: 'Regra não encontrada' });
  res.json(r);
});
router.delete('/price-rules/:id/:ruleId', (req, res) => {
  if (!db.deletePriceRule(req.params.id, req.params.ruleId)) return res.status(404).json({ error: 'Regra não encontrada' });
  res.json({ success: true });
});

// ─── Datas Especiais ──────────────────────────────────────────────────────────
router.get('/special-dates/:id', (req, res) => res.json(db.getSpecialDates(req.params.id)));
router.post('/special-dates/:id', (req, res) => res.json(db.saveSpecialDate(req.params.id, req.body)));
router.delete('/special-dates/:id/:dateId', (req, res) => {
  if (!db.deleteSpecialDate(req.params.id, req.params.dateId)) return res.status(404).json({ error: 'Data não encontrada' });
  res.json({ success: true });
});

// ─── Config OCPP (cache) ──────────────────────────────────────────────────────
router.get('/ocpp-config/:id', (req, res) => {
  const config = db.getOcppConfig(req.params.id);
  res.json(config || { keys: [], updatedAt: null });
});

// ─── Sessão ativa ─────────────────────────────────────────────────────────────
router.get('/chargers/:id/active-session', (req, res) => {
  const { connectorId } = req.query;
  const sessions = store.getAllSessions(req.params.id);
  res.json(sessions.filter(s => s.status === 'Active' &&
    (connectorId === undefined || s.connectorId === parseInt(connectorId))));
});

// ─── Comandos OCPP ────────────────────────────────────────────────────────────
async function ocppCmd(res, chargePointId, action, payload) {
  try {
    const result = await sendCall(chargePointId, action, payload);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

router.post('/chargers/:id/remote-start', (req, res) => {
  const { connectorId = 1, idTag = 'REMOTE' } = req.body;
  ocppCmd(res, req.params.id, 'RemoteStartTransaction', { connectorId, idTag });
});

router.post('/chargers/:id/remote-stop', (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) return res.status(400).json({ error: 'transactionId obrigatório' });
  ocppCmd(res, req.params.id, 'RemoteStopTransaction', { transactionId });
});

router.post('/chargers/:id/reset', (req, res) => {
  ocppCmd(res, req.params.id, 'Reset', { type: req.body.type || 'Soft' });
});

router.post('/chargers/:id/unlock-connector', (req, res) => {
  ocppCmd(res, req.params.id, 'UnlockConnector', { connectorId: req.body.connectorId || 1 });
});

router.post('/chargers/:id/change-availability', (req, res) => {
  ocppCmd(res, req.params.id, 'ChangeAvailability', {
    connectorId: req.body.connectorId ?? 0,
    type: req.body.type || 'Operative',
  });
});

router.post('/chargers/:id/get-configuration', async (req, res) => {
  try {
    const result = await sendCall(req.params.id, 'GetConfiguration', req.body.key ? { key: req.body.key } : {});
    if (result?.configurationKey) db.saveOcppConfig(req.params.id, result.configurationKey);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/chargers/:id/change-configuration', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key e value obrigatórios' });
  ocppCmd(res, req.params.id, 'ChangeConfiguration', { key, value: String(value) });
});

router.post('/chargers/:id/trigger-message', (req, res) => {
  const { requestedMessage = 'StatusNotification', connectorId } = req.body;
  const payload = { requestedMessage };
  if (connectorId !== undefined) payload.connectorId = connectorId;
  ocppCmd(res, req.params.id, 'TriggerMessage', payload);
});

router.post('/chargers/:id/update-firmware', (req, res) => {
  const { location, retrieveDate, retries = 3, retryInterval = 60 } = req.body;
  if (!location) return res.status(400).json({ error: 'location obrigatório' });
  ocppCmd(res, req.params.id, 'UpdateFirmware', {
    location, retrieveDate: retrieveDate || new Date().toISOString(), retries, retryInterval,
  });
});

router.post('/chargers/:id/get-diagnostics', (req, res) => {
  const { location, startTime, stopTime, retries = 3, retryInterval = 60 } = req.body;
  if (!location) return res.status(400).json({ error: 'location obrigatório' });
  ocppCmd(res, req.params.id, 'GetDiagnostics', { location, startTime, stopTime, retries, retryInterval });
});

router.post('/chargers/:id/reserve-now', (req, res) => {
  const { connectorId = 1, expiryDate, idTag, reservationId } = req.body;
  ocppCmd(res, req.params.id, 'ReserveNow', {
    connectorId,
    expiryDate: expiryDate || new Date(Date.now() + 30*60000).toISOString(),
    idTag: idTag || 'RESERVE',
    reservationId: reservationId || Date.now(),
  });
});

router.post('/chargers/:id/cancel-reservation', (req, res) => {
  if (!req.body.reservationId) return res.status(400).json({ error: 'reservationId obrigatório' });
  ocppCmd(res, req.params.id, 'CancelReservation', { reservationId: req.body.reservationId });
});

router.post('/chargers/:id/send-local-list', (req, res) => {
  ocppCmd(res, req.params.id, 'SendLocalList', {
    listVersion: req.body.listVersion || 1,
    localAuthorizationList: req.body.localAuthorizationList || [],
    updateType: req.body.updateType || 'Full',
  });
});

router.post('/chargers/:id/clear-cache', (req, res) => {
  ocppCmd(res, req.params.id, 'ClearCache', {});
});

module.exports = router;
