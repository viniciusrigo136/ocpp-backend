// db-persist.js — persistência completa em arquivo JSON
// Todos os dados OCPP são salvos aqui: carregadores, sessões, logs, falhas, uptime, manutenção, etc.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const FILES = {
  chargers:   path.join(DATA_DIR, 'chargers.json'),
  sessions:   path.join(DATA_DIR, 'sessions.json'),
  logs:       path.join(DATA_DIR, 'logs.json'),
  faults:     path.join(DATA_DIR, 'faults.json'),
  uptime:     path.join(DATA_DIR, 'uptime.json'),
  maintenance: path.join(DATA_DIR, 'maintenance.json'),
  notifications: path.join(DATA_DIR, 'notifications.json'),
  params:     path.join(DATA_DIR, 'params.json'),
  energyCosts: path.join(DATA_DIR, 'energy-costs.json'),
  priceRules: path.join(DATA_DIR, 'price-rules.json'),
  specialDates: path.join(DATA_DIR, 'special-dates.json'),
  ocppConfig: path.join(DATA_DIR, 'ocpp-config.json'),
  counters:   path.join(DATA_DIR, 'counters.json'),
};

const LIMITS = {
  logs: 1000,
  faults: 500,
  uptime: 2000,
  sessions: 10000,
};

// Garante pasta data
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Cache em memória para performance
const cache = {};
const saveTimers = {};

function loadFile(key) {
  if (cache[key] !== undefined) return cache[key];
  try {
    if (fs.existsSync(FILES[key])) {
      cache[key] = JSON.parse(fs.readFileSync(FILES[key], 'utf8'));
      return cache[key];
    }
  } catch (err) {
    console.error(`[DB] Erro ao carregar ${key}:`, err.message);
  }
  cache[key] = {};
  return cache[key];
}

function saveFile(key) {
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => {
    try {
      fs.writeFileSync(FILES[key], JSON.stringify(cache[key], null, 2));
    } catch (err) {
      console.error(`[DB] Erro ao salvar ${key}:`, err.message);
    }
  }, 300);
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Contadores ───────────────────────────────────────────────────────────────
function getCounter(name) {
  const counters = loadFile('counters');
  return counters[name] || 1000;
}

function incrementCounter(name) {
  const counters = loadFile('counters');
  counters[name] = (counters[name] || 1000) + 1;
  saveFile('counters');
  return counters[name];
}

// ─── Carregadores ─────────────────────────────────────────────────────────────
function getAllChargers() {
  const data = loadFile('chargers');
  return Object.values(data);
}

function getCharger(chargePointId) {
  const data = loadFile('chargers');
  return data[chargePointId] || null;
}

function saveCharger(charger) {
  const data = loadFile('chargers');
  data[charger.chargePointId] = { ...charger, updatedAt: new Date().toISOString() };
  saveFile('chargers');
  return data[charger.chargePointId];
}

// ─── Sessões ──────────────────────────────────────────────────────────────────
function startSession(chargePointId, connectorId, idTag) {
  const data = loadFile('sessions');
  const transactionId = incrementCounter('transactionId');
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
    createdAt: new Date().toISOString(),
  };
  data[transactionId] = session;

  // Limitar sessões salvas (manter últimas 10000)
  const keys = Object.keys(data);
  if (keys.length > LIMITS.sessions) {
    const oldest = keys.sort()[0];
    delete data[oldest];
  }

  saveFile('sessions');
  return session;
}

function stopSession(transactionId, meterStop, reason) {
  const data = loadFile('sessions');
  const session = data[transactionId];
  if (!session) return null;
  session.endTime = new Date().toISOString();
  session.meterStop = meterStop;
  session.status = 'Finished';
  session.stopReason = reason || 'Local';
  session.energyDeliveredKwh = parseFloat(((meterStop - session.meterStart) / 1000).toFixed(3));
  saveFile('sessions');
  return session;
}

function addMeterValue(transactionId, values) {
  const data = loadFile('sessions');
  const session = data[transactionId];
  if (!session) return;
  if (!session.meterValues) session.meterValues = [];
  session.meterValues.push({ timestamp: new Date().toISOString(), values });
  // Manter apenas últimas 100 leituras por sessão para não inflar o arquivo
  if (session.meterValues.length > 100) session.meterValues = session.meterValues.slice(-100);
  saveFile('sessions');
}

function getSession(transactionId) {
  const data = loadFile('sessions');
  return data[transactionId] || null;
}

function getAllSessions(chargePointId) {
  const data = loadFile('sessions');
  const all = Object.values(data).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  return chargePointId ? all.filter(s => s.chargePointId === chargePointId) : all;
}

// ─── Logs ─────────────────────────────────────────────────────────────────────
function addLog(chargePointId, eventType, payload = {}) {
  const data = loadFile('logs');
  if (!data[chargePointId]) data[chargePointId] = [];
  data[chargePointId].unshift({
    id: generateId(),
    chargePointId,
    eventType,
    payload,
    createdAt: new Date().toISOString(),
  });
  if (data[chargePointId].length > LIMITS.logs) data[chargePointId].splice(LIMITS.logs);
  saveFile('logs');
}

function getLogs(chargePointId, limit = 50, eventType = null) {
  const data = loadFile('logs');
  const logs = data[chargePointId] || [];
  const filtered = eventType ? logs.filter(l => l.eventType === eventType) : logs;
  return filtered.slice(0, limit);
}

// ─── Falhas ───────────────────────────────────────────────────────────────────
function addFault(chargePointId, fault) {
  const data = loadFile('faults');
  if (!data[chargePointId]) data[chargePointId] = [];
  data[chargePointId].unshift({
    id: generateId(),
    chargePointId,
    connectorId: fault.connectorId,
    status: fault.status,
    errorCode: fault.errorCode,
    vendorError: fault.vendorError,
    info: fault.info,
    occurredAt: new Date().toISOString(),
  });
  if (data[chargePointId].length > LIMITS.faults) data[chargePointId].splice(LIMITS.faults);
  saveFile('faults');
}

function getFaults(chargePointId, limit = 200) {
  const data = loadFile('faults');
  const faults = data[chargePointId] || [];
  return faults.slice(0, limit);
}

// ─── Uptime ───────────────────────────────────────────────────────────────────
function addUptimeEvent(chargePointId, eventType, extra = {}) {
  const data = loadFile('uptime');
  if (!data[chargePointId]) data[chargePointId] = [];
  data[chargePointId].unshift({
    chargePointId,
    eventType,
    ...extra,
    createdAt: new Date().toISOString(),
  });
  if (data[chargePointId].length > LIMITS.uptime) data[chargePointId].splice(LIMITS.uptime);
  saveFile('uptime');
}

function getUptimeStats(chargePointId, from, to, isOnline = false) {
  const data = loadFile('uptime');
  const events = data[chargePointId] || [];
  const inRange = events.filter(e => {
    const t = new Date(e.createdAt);
    return t >= from && t <= to;
  });

  const totalMs = to - from;
  let onlineMs = 0;
  let offlineMs = 0;
  let incidents = [];

  const sorted = [...inRange].reverse();
  let lastConnected = null;
  let lastDisconnected = null;

  for (const ev of sorted) {
    const t = new Date(ev.createdAt);
    if (ev.eventType === 'connected') {
      lastConnected = t;
      if (lastDisconnected) {
        const dur = lastDisconnected - t;
        offlineMs += dur;
        incidents.push({
          type: 'disconnected',
          start: t.toISOString(),
          end: lastDisconnected.toISOString(),
          durationSeconds: Math.round(dur / 1000),
          errorCode: ev.wsCloseCode,
          message: ev.message || 'Desconexão',
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

  if (isOnline && lastConnected) onlineMs += to - lastConnected;

  const uptimePercent = totalMs > 0 ? Math.min(100, (onlineMs / totalMs) * 100) : 0;

  return {
    chargePointId,
    from: from.toISOString(),
    to: to.toISOString(),
    uptimePercent: parseFloat(uptimePercent.toFixed(2)),
    onlineMs,
    offlineMs,
    onlineFormatted: formatDuration(onlineMs),
    offlineFormatted: formatDuration(offlineMs),
    incidents: incidents.slice(0, 100),
    totalEvents: inRange.length,
    isOnline,
  };
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${sec}s`;
  return `${sec}s`;
}

// ─── Manutenção ───────────────────────────────────────────────────────────────
function getMaintenancePlans(chargePointId) {
  const data = loadFile('maintenance');
  return (data[chargePointId] || {}).plans || [];
}

function addMaintenancePlan(chargePointId, plan) {
  const data = loadFile('maintenance');
  if (!data[chargePointId]) data[chargePointId] = { plans: [], records: [] };
  const newPlan = {
    id: generateId(),
    chargePointId,
    typeName: plan.typeName,
    intervalDays: plan.intervalDays || 30,
    lastDoneAt: null,
    nextDueAt: null,
    alertEmail: plan.alertEmail !== false,
    alertWhatsapp: plan.alertWhatsapp || false,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  data[chargePointId].plans.push(newPlan);
  saveFile('maintenance');
  return newPlan;
}

function updateMaintenancePlan(chargePointId, planId, updates) {
  const data = loadFile('maintenance');
  const plans = (data[chargePointId] || {}).plans || [];
  const idx = plans.findIndex(p => p.id === planId);
  if (idx === -1) return null;
  plans[idx] = { ...plans[idx], ...updates };
  saveFile('maintenance');
  return plans[idx];
}

function deleteMaintenancePlan(chargePointId, planId) {
  const data = loadFile('maintenance');
  if (!data[chargePointId]) return false;
  const before = data[chargePointId].plans.length;
  data[chargePointId].plans = data[chargePointId].plans.filter(p => p.id !== planId);
  saveFile('maintenance');
  return data[chargePointId].plans.length < before;
}

function getMaintenanceRecords(chargePointId) {
  const data = loadFile('maintenance');
  return (data[chargePointId] || {}).records || [];
}

function addMaintenanceRecord(chargePointId, record) {
  const data = loadFile('maintenance');
  if (!data[chargePointId]) data[chargePointId] = { plans: [], records: [] };
  const newRecord = {
    id: generateId(),
    chargePointId,
    planId: record.planId || null,
    planName: record.planName || null,
    doneAt: record.doneAt || new Date().toISOString(),
    doneBy: record.doneBy || null,
    notes: record.notes || null,
    createdAt: new Date().toISOString(),
  };
  data[chargePointId].records.unshift(newRecord);
  // Atualiza nextDueAt do plano
  if (record.planId) {
    const plan = data[chargePointId].plans.find(p => p.id === record.planId);
    if (plan) {
      plan.lastDoneAt = newRecord.doneAt;
      const next = new Date(newRecord.doneAt);
      next.setDate(next.getDate() + plan.intervalDays);
      plan.nextDueAt = next.toISOString();
    }
  }
  saveFile('maintenance');
  return newRecord;
}

// ─── Notificações ─────────────────────────────────────────────────────────────
function getNotifications(chargePointId) {
  const data = loadFile('notifications');
  if (!data[chargePointId]) {
    data[chargePointId] = [
      { id: generateId(), eventType: 'offline', label: 'Carregador offline', channel: 'email', email: '', whatsapp: '', thresholdMinutes: 5, enabled: false },
      { id: generateId(), eventType: 'faulted', label: 'Status Faulted detectado', channel: 'email', email: '', whatsapp: '', thresholdMinutes: null, enabled: false },
      { id: generateId(), eventType: 'session_started', label: 'Sessão iniciada', channel: 'email', email: '', whatsapp: '', thresholdMinutes: null, enabled: false },
      { id: generateId(), eventType: 'session_stopped', label: 'Sessão encerrada', channel: 'email', email: '', whatsapp: '', thresholdMinutes: null, enabled: false },
      { id: generateId(), eventType: 'finishing_timeout', label: 'Conector em Finishing por muito tempo', channel: 'whatsapp', email: '', whatsapp: '', thresholdMinutes: 5, enabled: false },
    ];
    saveFile('notifications');
  }
  return data[chargePointId];
}

function saveNotifications(chargePointId, notifications) {
  const data = loadFile('notifications');
  data[chargePointId] = notifications;
  saveFile('notifications');
  return notifications;
}

// ─── Parâmetros Operacionais ──────────────────────────────────────────────────
function getParams(chargePointId) {
  const data = loadFile('params');
  if (!data[chargePointId]) {
    data[chargePointId] = {
      pixDefaultValue: 10.00,
      stripePreAuthValue: 100.00,
      contactorTimeoutSeconds: 100,
      whatsappSupport: '',
      whatsappConfirmOnLogin: true,
      allowStartWithCable: false,
      cpStartTimeoutSeconds: 150,
      startDelayPixSeconds: 8.0,
      startDelayCardSeconds: 8.0,
      ocppHealthcheckInterval: 240,
      finishingAlertMinutes: 5,
      updatedAt: new Date().toISOString(),
    };
    saveFile('params');
  }
  return data[chargePointId];
}

function saveParams(chargePointId, params) {
  const data = loadFile('params');
  data[chargePointId] = { ...getParams(chargePointId), ...params, updatedAt: new Date().toISOString() };
  saveFile('params');
  return data[chargePointId];
}

// ─── Config OCPP (cache GetConfiguration) ────────────────────────────────────
function getOcppConfig(chargePointId) {
  const data = loadFile('ocppConfig');
  return data[chargePointId] || null;
}

function saveOcppConfig(chargePointId, configKeys) {
  const data = loadFile('ocppConfig');
  data[chargePointId] = { keys: configKeys, updatedAt: new Date().toISOString() };
  saveFile('ocppConfig');
  return data[chargePointId];
}

// ─── Custos de Energia ────────────────────────────────────────────────────────
function getEnergyCosts(chargePointId) {
  const data = loadFile('energyCosts');
  return data[chargePointId] || [];
}

function saveEnergyCost(chargePointId, cost) {
  const data = loadFile('energyCosts');
  if (!data[chargePointId]) data[chargePointId] = [];
  const idx = data[chargePointId].findIndex(c => c.month === cost.month);
  const entry = {
    id: idx >= 0 ? data[chargePointId][idx].id : generateId(),
    chargePointId,
    month: cost.month,
    costPerKwh: cost.costPerKwh,
    flag: cost.flag || 'verde',
    demandKw: cost.demandKw || null,
    distributionRate: cost.distributionRate || null,
    notes: cost.notes || null,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) data[chargePointId][idx] = entry;
  else data[chargePointId].unshift(entry);
  saveFile('energyCosts');
  return entry;
}

// ─── Regras de Preço ──────────────────────────────────────────────────────────
function getPriceRules(chargePointId) {
  const data = loadFile('priceRules');
  return data[chargePointId] || [];
}

function addPriceRule(chargePointId, rule) {
  const data = loadFile('priceRules');
  if (!data[chargePointId]) data[chargePointId] = [];
  const newRule = {
    id: generateId(), chargePointId,
    name: rule.name || null,
    daysOfWeek: rule.daysOfWeek || [0,1,2,3,4,5,6],
    hourStart: rule.hourStart ?? 0,
    hourEnd: rule.hourEnd ?? 23,
    pricePix: rule.pricePix,
    priceCard: rule.priceCard,
    validFrom: rule.validFrom || null,
    validUntil: rule.validUntil || null,
    priority: rule.priority || 0,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  data[chargePointId].push(newRule);
  saveFile('priceRules');
  return newRule;
}

function updatePriceRule(chargePointId, ruleId, updates) {
  const data = loadFile('priceRules');
  const rules = data[chargePointId] || [];
  const idx = rules.findIndex(r => r.id === ruleId);
  if (idx === -1) return null;
  rules[idx] = { ...rules[idx], ...updates };
  saveFile('priceRules');
  return rules[idx];
}

function deletePriceRule(chargePointId, ruleId) {
  const data = loadFile('priceRules');
  if (!data[chargePointId]) return false;
  const before = data[chargePointId].length;
  data[chargePointId] = data[chargePointId].filter(r => r.id !== ruleId);
  saveFile('priceRules');
  return data[chargePointId].length < before;
}

// ─── Datas Especiais ──────────────────────────────────────────────────────────
function getSpecialDates(chargePointId) {
  const data = loadFile('specialDates');
  return data[chargePointId] || [];
}

function saveSpecialDate(chargePointId, specialDate) {
  const data = loadFile('specialDates');
  if (!data[chargePointId]) data[chargePointId] = [];
  const idx = data[chargePointId].findIndex(d => d.date === specialDate.date);
  const entry = {
    id: idx >= 0 ? data[chargePointId][idx].id : generateId(),
    chargePointId,
    date: specialDate.date,
    name: specialDate.name || null,
    pricePix: specialDate.pricePix || null,
    priceCard: specialDate.priceCard || null,
    enabled: specialDate.enabled !== false,
  };
  if (idx >= 0) data[chargePointId][idx] = entry;
  else data[chargePointId].push(entry);
  saveFile('specialDates');
  return entry;
}

function deleteSpecialDate(chargePointId, dateId) {
  const data = loadFile('specialDates');
  if (!data[chargePointId]) return false;
  const before = data[chargePointId].length;
  data[chargePointId] = data[chargePointId].filter(d => d.id !== dateId);
  saveFile('specialDates');
  return data[chargePointId].length < before;
}

module.exports = {
  // Carregadores
  getAllChargers, getCharger, saveCharger,
  // Sessões
  startSession, stopSession, addMeterValue, getSession, getAllSessions,
  // Logs
  addLog, getLogs,
  // Falhas
  addFault, getFaults,
  // Uptime
  addUptimeEvent, getUptimeStats,
  // Manutenção
  getMaintenancePlans, addMaintenancePlan, updateMaintenancePlan, deleteMaintenancePlan,
  getMaintenanceRecords, addMaintenanceRecord,
  // Notificações
  getNotifications, saveNotifications,
  // Parâmetros
  getParams, saveParams,
  // Config OCPP
  getOcppConfig, saveOcppConfig,
  // Custos
  getEnergyCosts, saveEnergyCost,
  // Preços
  getPriceRules, addPriceRule, updatePriceRule, deletePriceRule,
  // Datas especiais
  getSpecialDates, saveSpecialDate, deleteSpecialDate,
};
