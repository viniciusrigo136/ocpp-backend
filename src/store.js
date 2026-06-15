// store.js — estado em memória de todos os carregadores conectados

const chargers = new Map();       // chargePointId -> { ws, info, connectors, sessions }
const sessions = new Map();       // transactionId -> session object
let transactionCounter = 1000;

function getOrCreateCharger(chargePointId) {
  if (!chargers.has(chargePointId)) {
    chargers.set(chargePointId, {
      chargePointId,
      ws: null,
      status: 'Disconnected',
      info: {},
      connectors: {},   // connectorId -> { status, errorCode }
      lastHeartbeat: null,
      connectedAt: null,
    });
  }
  return chargers.get(chargePointId);
}

function setChargerWs(chargePointId, ws) {
  const c = getOrCreateCharger(chargePointId);
  c.ws = ws;
  c.status = 'Connected';
  c.connectedAt = new Date().toISOString();
}

function removeChargerWs(chargePointId) {
  const c = chargers.get(chargePointId);
  if (c) {
    c.ws = null;
    c.status = 'Disconnected';
  }
}

function setChargerInfo(chargePointId, info) {
  const c = getOrCreateCharger(chargePointId);
  c.info = { ...c.info, ...info };
}

function setConnectorStatus(chargePointId, connectorId, status, errorCode = 'NoError') {
  const c = getOrCreateCharger(chargePointId);
  c.connectors[connectorId] = { status, errorCode, updatedAt: new Date().toISOString() };
  if (connectorId === 0) c.status = status; // connector 0 = charger overall
}

function updateHeartbeat(chargePointId) {
  const c = getOrCreateCharger(chargePointId);
  c.lastHeartbeat = new Date().toISOString();
}

function startSession(chargePointId, connectorId, idTag) {
  const transactionId = ++transactionCounter;
  const session = {
    transactionId,
    chargePointId,
    connectorId,
    idTag,
    startTime: new Date().toISOString(),
    endTime: null,
    meterStart: 0,
    meterStop: null,
    meterValues: [],
    status: 'Active',
    stopReason: null,
  };
  sessions.set(transactionId, session);
  return session;
}

function stopSession(transactionId, meterStop, reason) {
  const session = sessions.get(transactionId);
  if (session) {
    session.endTime = new Date().toISOString();
    session.meterStop = meterStop;
    session.status = 'Finished';
    session.stopReason = reason;
    const energyKwh = ((meterStop - session.meterStart) / 1000).toFixed(3);
    session.energyDeliveredKwh = parseFloat(energyKwh);
  }
  return session;
}

function addMeterValue(transactionId, values) {
  const session = sessions.get(transactionId);
  if (session) {
    session.meterValues.push({ timestamp: new Date().toISOString(), values });
  }
}

function getAllChargers() {
  return Array.from(chargers.values()).map(c => ({
    chargePointId: c.chargePointId,
    status: c.status,
    info: c.info,
    connectors: c.connectors,
    lastHeartbeat: c.lastHeartbeat,
    connectedAt: c.connectedAt,
    online: c.ws !== null,
  }));
}

function getCharger(chargePointId) {
  const c = chargers.get(chargePointId);
  if (!c) return null;
  return {
    chargePointId: c.chargePointId,
    status: c.status,
    info: c.info,
    connectors: c.connectors,
    lastHeartbeat: c.lastHeartbeat,
    connectedAt: c.connectedAt,
    online: c.ws !== null,
  };
}

function getChargerWs(chargePointId) {
  return chargers.get(chargePointId)?.ws || null;
}

function getAllSessions(chargePointId) {
  const all = Array.from(sessions.values());
  return chargePointId ? all.filter(s => s.chargePointId === chargePointId) : all;
}

function getSession(transactionId) {
  return sessions.get(parseInt(transactionId)) || null;
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
};
