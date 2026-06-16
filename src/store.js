// store.js — estado em memória de todos os carregadores conectados

const chargers = new Map();
const sessions = new Map();
const logsStore = new Map();       // chargePointId -> array de logs (últimos 500)
const faultsStore = new Map();     // chargePointId -> array de falhas
const uptimeEvents = new Map();    // chargePointId -> array de eventos de conexão
let transactionCounter = 1000;

const MAX_LOGS = 500;
const MAX_FAULTS = 200;
const MAX_UPTIME_EVENTS = 1000;

// ─── Chargers ─────────────────────────────────────────────────────────────────

function getOrCreateCharger(chargePointId) {
  if (!chargers.has(chargePointId)) {
    chargers.set(chargePointId, {
      chargePointId,
      ws: null,
      status: 'Disconnected',
      info: {},
      connectors: {},
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
  addUptimeEvent(chargePointId, 'connected');
}

function removeChargerWs(chargePointId, code, reason) {
  const c = chargers.get(chargePointId);
  if (c) {
    c.ws = null;
    c.status = 'Disconnected';
    addUptimeEvent(chargePointId, 'disconnected', {
      wsCloseCode: code,
      message: reason ? reason.toString() : null,
    });
  }
}

function setChargerInfo(chargePointId, info) {
  const c = getOrCreateCharger(chargePointId);
  c.info = { ...c.info, ...info };
  c.info.lastBoot = new Date().toISOString();
  addLog(chargePointId, 'charger.boot', { info });
}

function setConnectorStatus(chargePointId, connectorId, status, errorCode = 'NoError', vendorError = null, info = null) {
  const c = getOrCreateCharger(chargePointId);
  c.connectors[connectorId] = {
    status,
    errorCode,
    vendorError,
    info,
    updatedAt: new Date().toISOString(),
  };
  if (connectorId === 0) c.status = status;

  addLog(chargePointId, 'connector.status', { connectorId, status, errorCode, vendorError, info });

  // Registrar falha se Faulted
  if (status === 'Faulted' || (errorCode && errorCode !== 'NoError')) {
    addFault(chargePointId, connectorId, status, errorCode, vendorError, info);
  }
}

function updateHeartbeat(chargePointId) {
  const c = getOrCreateCharger(chargePointId);
  c.lastHeartbeat = new Date().toISOString();
  addLog(chargePointId, 'charger.heartbeat', { timestamp: c.lastHeartbeat });
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

// ─── Sessões ──────────────────────────────────────────────────────────────────

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
    energyDeliveredKwh: null,
  };
  sessions.set(transactionId, session);
  addLog(chargePointId, 'session.started', { transactionId, connectorId, idTag });
  return session;
}

function stopSession(transactionId, meterStop, reason) {
  const session = sessions.get(transactionId);
  if (session) {
    session.endTime = new Date().toISOString();
    session.meterStop = meterStop;
    session.status = 'Finished';
    session.stopReason = reason;
    session.energyDeliveredKwh = parseFloat(((meterStop - session.meterStart) / 1000).toFixed(3));
    addLog(session.chargePointId, 'session.stopped', {
      transactionId,
      energyDeliveredKwh: session.energyDeliveredKwh,
      reason,
    });
  }
  return session;
}

function addMeterValue(transactionId, values) {
  const session = sessions.get(transactionId);
  if (session) {
    session.meterValues.push({ timestamp: new Date().toISOString(), values });
    // Log de leitura de energia
    addLog(session.chargePointId, 'session.meterValues', {
      transactionId,
      connectorId: session.connectorId,
      values,
    });
  }
}

function getAllSessions(chargePointId) {
  const all = Array.from(sessions.values());
  return chargePointId ? all.filter(s => s.chargePointId === chargePointId) : all;
}

function getSession(transactionId) {
  return sessions.get(parseInt(transactionId)) || null;
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

function addLog(chargePointId, eventType, payload = {}) {
  if (!logsStore.has(chargePointId)) logsStore.set(chargePointId, []);
  const logs = logsStore.get(chargePointId);
  logs.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chargePointId,
    eventType,
    payload,
    createdAt: new Date().toISOString(),
  });
  if (logs.length > MAX_LOGS) logs.splice(MAX_LOGS);
}

function getLogs(chargePointId, limit = 50, eventType = null) {
  const logs = logsStore.get(chargePointId) || [];
  let filtered = eventType ? logs.filter(l => l.eventType === eventType) : logs;
  return filtered.slice(0, limit);
}

// ─── Falhas ───────────────────────────────────────────────────────────────────

function addFault(chargePointId, connectorId, status, errorCode, vendorError, info) {
  if (!faultsStore.has(chargePointId)) faultsStore.set(chargePointId, []);
  const faults = faultsStore.get(chargePointId);
  faults.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chargePointId,
    connectorId,
    status,
    errorCode,
    vendorError,
    info,
    occurredAt: new Date().toISOString(),
  });
  if (faults.length > MAX_FAULTS) faults.splice(MAX_FAULTS);
}

function getFaults(chargePointId, limit = 200) {
  const faults = faultsStore.get(chargePointId) || [];
  return faults.slice(0, limit);
}

// ─── Uptime ───────────────────────────────────────────────────────────────────

function addUptimeEvent(chargePointId, eventType, extra = {}) {
  if (!uptimeEvents.has(chargePointId)) uptimeEvents.set(chargePointId, []);
  const events = uptimeEvents.get(chargePointId);
  events.unshift({
    chargePointId,
    eventType,
    ...extra,
    createdAt: new Date().toISOString(),
  });
  if (events.length > MAX_UPTIME_EVENTS) events.splice(MAX_UPTIME_EVENTS);
}

function getUptimeStats(chargePointId, from, to) {
  const events = uptimeEvents.get(chargePointId) || [];
  const inRange = events.filter(e => {
    const t = new Date(e.createdAt);
    return t >= from && t <= to;
  });

  const totalMs = to - from;
  let onlineMs = 0;
  let offlineMs = 0;
  let faultMs = 0;
  let incidents = [];

  // Calcula períodos de conexão/desconexão
  const sorted = [...inRange].reverse();
  let lastConnected = null;
  let lastDisconnected = null;

  for (const ev of sorted) {
    const t = new Date(ev.createdAt);
    if (ev.eventType === 'connected') {
      lastConnected = t;
      if (lastDisconnected) {
        offlineMs += lastDisconnected - t;
        incidents.push({
          type: 'disconnected',
          start: t.toISOString(),
          end: lastDisconnected.toISOString(),
          durationSeconds: Math.round((lastDisconnected - t) / 1000),
          errorCode: ev.wsCloseCode,
          message: ev.message,
        });
        lastDisconnected = null;
      }
    } else if (ev.eventType === 'disconnected') {
      lastDisconnected = t;
      if (lastConnected) {
        onlineMs += t - lastConnected;
        lastConnected = null;
      }
    }
  }

  const charger = chargers.get(chargePointId);
  if (charger?.ws && lastConnected) {
    onlineMs += to - lastConnected;
  }

  const uptimePercent = totalMs > 0 ? Math.min(100, (onlineMs / totalMs) * 100) : 0;

  return {
    chargePointId,
    from: from.toISOString(),
    to: to.toISOString(),
    uptimePercent: parseFloat(uptimePercent.toFixed(2)),
    onlineMs,
    offlineMs,
    faultMs,
    onlineFormatted: formatDuration(onlineMs),
    offlineFormatted: formatDuration(offlineMs),
    incidents: incidents.slice(0, 100),
    totalEvents: inRange.length,
  };
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
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
  getFaults,
  getUptimeStats,
  addLog,
  addUptimeEvent,
};
