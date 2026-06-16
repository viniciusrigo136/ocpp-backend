// store.js — estado dos carregadores com persistência em disco
// Conexões WebSocket ficam em memória (não serializáveis)
// Sessões, logs, falhas e uptime são persistidos em disco via db-persist.js

const persist = require('./db-persist');

// ─── Conexões WebSocket (apenas memória) ──────────────────────────────────────
const wsConnections = new Map(); // chargePointId -> ws

// ─── Carregadores ─────────────────────────────────────────────────────────────

function getOrCreateCharger(chargePointId) {
  let charger = persist.getCharger(chargePointId);
  if (!charger) {
    charger = persist.saveCharger({
      chargePointId,
      status: 'Disconnected',
      info: {},
      connectors: {},
      lastHeartbeat: null,
      connectedAt: null,
      createdAt: new Date().toISOString(),
    });
  }
  return charger;
}

function setChargerWs(chargePointId, ws) {
  wsConnections.set(chargePointId, ws);
  const charger = getOrCreateCharger(chargePointId);
  persist.saveCharger({
    ...charger,
    status: 'Connected',
    connectedAt: new Date().toISOString(),
  });
  persist.addUptimeEvent(chargePointId, 'connected', {});
}

function removeChargerWs(chargePointId, code, reason) {
  wsConnections.delete(chargePointId);
  const charger = persist.getCharger(chargePointId);
  if (charger) {
    persist.saveCharger({
      ...charger,
      status: 'Disconnected',
    });
  }
  persist.addUptimeEvent(chargePointId, 'disconnected', {
    wsCloseCode: code,
    message: reason ? reason.toString() : null,
  });
}

function setChargerInfo(chargePointId, info) {
  const charger = getOrCreateCharger(chargePointId);
  persist.saveCharger({
    ...charger,
    info: { ...charger.info, ...info, lastBoot: new Date().toISOString() },
  });
  persist.addLog(chargePointId, 'charger.boot', { info });
}

function setConnectorStatus(chargePointId, connectorId, status, errorCode = 'NoError', vendorError = null, info = null) {
  const charger = getOrCreateCharger(chargePointId);
  const connectors = { ...charger.connectors };
  connectors[connectorId] = {
    status,
    errorCode,
    vendorError,
    info,
    updatedAt: new Date().toISOString(),
  };
  persist.saveCharger({
    ...charger,
    connectors,
    status: connectorId === 0 ? status : charger.status,
  });
  persist.addLog(chargePointId, 'connector.status', { connectorId, status, errorCode, vendorError, info });

  if (status === 'Faulted' || (errorCode && errorCode !== 'NoError')) {
    persist.addFault(chargePointId, { connectorId, status, errorCode, vendorError, info });
  }
}

function updateHeartbeat(chargePointId) {
  const charger = getOrCreateCharger(chargePointId);
  const ts = new Date().toISOString();
  persist.saveCharger({ ...charger, lastHeartbeat: ts });
  persist.addLog(chargePointId, 'charger.heartbeat', { timestamp: ts });
}

function getAllChargers() {
  return persist.getAllChargers().map(c => ({
    ...c,
    online: wsConnections.has(c.chargePointId),
  }));
}

function getCharger(chargePointId) {
  const c = persist.getCharger(chargePointId);
  if (!c) return null;
  return { ...c, online: wsConnections.has(chargePointId) };
}

function getChargerWs(chargePointId) {
  return wsConnections.get(chargePointId) || null;
}

// ─── Sessões ──────────────────────────────────────────────────────────────────

function startSession(chargePointId, connectorId, idTag) {
  const session = persist.startSession(chargePointId, connectorId, idTag);
  persist.addLog(chargePointId, 'session.started', {
    transactionId: session.transactionId, connectorId, idTag,
  });
  return session;
}

function stopSession(transactionId, meterStop, reason) {
  const session = persist.stopSession(transactionId, meterStop, reason);
  if (session) {
    persist.addLog(session.chargePointId, 'session.stopped', {
      transactionId,
      energyDeliveredKwh: session.energyDeliveredKwh,
      reason,
    });
  }
  return session;
}

function addMeterValue(transactionId, values) {
  const session = persist.getSession(transactionId);
  if (session) {
    persist.addMeterValue(transactionId, values);
    persist.addLog(session.chargePointId, 'session.meterValues', {
      transactionId,
      connectorId: session.connectorId,
      values,
    });
  }
}

function getAllSessions(chargePointId) {
  return persist.getAllSessions(chargePointId);
}

function getSession(transactionId) {
  return persist.getSession(parseInt(transactionId));
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

function getLogs(chargePointId, limit = 50, eventType = null) {
  return persist.getLogs(chargePointId, limit, eventType);
}

function addLog(chargePointId, eventType, payload = {}) {
  persist.addLog(chargePointId, eventType, payload);
}

// ─── Falhas ───────────────────────────────────────────────────────────────────

function getFaults(chargePointId, limit = 200) {
  return persist.getFaults(chargePointId, limit);
}

// ─── Uptime ───────────────────────────────────────────────────────────────────

function getUptimeStats(chargePointId, from, to) {
  return persist.getUptimeStats(chargePointId, from, to, wsConnections.has(chargePointId));
}

function addUptimeEvent(chargePointId, eventType, extra = {}) {
  persist.addUptimeEvent(chargePointId, eventType, extra);
}

module.exports = {
  getOrCreateCharger,
  setChargerWs,
  removeChargerWs,
  setChargerInfo,
  setConnectorStatus,
  updateHeartbeat,
  startSession,
  stopSession,
  addMeterValue,
  getAllChargers,
  getCharger,
  getChargerWs,
  getAllSessions,
  getSession,
  getLogs,
  addLog,
  getFaults,
  getUptimeStats,
  addUptimeEvent,
};
