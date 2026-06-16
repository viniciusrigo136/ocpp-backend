// ocppHandler.js — processa mensagens OCPP 1.6

const store = require('./store');
const { sendWebhook } = require('./webhook');

const DEBUG = process.env.DEBUG === 'true';
const pendingCalls = new Map();

function log(chargePointId, ...args) {
  if (DEBUG) console.log(`[OCPP][${chargePointId}]`, ...args);
}

function sendCall(chargePointId, action, payload = {}) {
  const ws = store.getChargerWs(chargePointId);
  if (!ws || ws.readyState !== 1) {
    return Promise.reject(new Error(`Carregador ${chargePointId} não está conectado`));
  }
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const message = JSON.stringify([2, uniqueId, action, payload]);

  return new Promise((resolve, reject) => {
    pendingCalls.set(uniqueId, { resolve, reject, action });
    ws.send(message);
    log(chargePointId, `→ CALL ${action}`, payload);
    setTimeout(() => {
      if (pendingCalls.has(uniqueId)) {
        pendingCalls.delete(uniqueId);
        reject(new Error(`Timeout aguardando resposta de ${action}`));
      }
    }, 30000);
  });
}

function handleMessage(chargePointId, rawMessage) {
  let msg;
  try { msg = JSON.parse(rawMessage); }
  catch { console.error(`[OCPP][${chargePointId}] Mensagem inválida`); return; }

  const [typeId, uniqueId, ...rest] = msg;

  if (typeId === 2) {
    const [action, payload] = rest;
    log(chargePointId, `← CALL ${action}`, payload);
    handleCall(chargePointId, uniqueId, action, payload || {});
  } else if (typeId === 3) {
    const [payload] = rest;
    log(chargePointId, `← CALLRESULT [${uniqueId}]`, payload);
    const pending = pendingCalls.get(uniqueId);
    if (pending) { pendingCalls.delete(uniqueId); pending.resolve(payload); }
  } else if (typeId === 4) {
    const [errorCode, errorDescription] = rest;
    log(chargePointId, `← CALLERROR [${uniqueId}]`, errorCode, errorDescription);
    const pending = pendingCalls.get(uniqueId);
    if (pending) { pendingCalls.delete(uniqueId); pending.reject(new Error(`${errorCode}: ${errorDescription}`)); }
  }
}

function handleCall(chargePointId, uniqueId, action, payload) {
  const ws = store.getChargerWs(chargePointId);
  function reply(result) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify([3, uniqueId, result]));
  }

  switch (action) {

    case 'BootNotification': {
      store.setChargerInfo(chargePointId, {
        vendor: payload.chargePointVendor,
        model: payload.chargePointModel,
        serialNumber: payload.chargePointSerialNumber,
        firmwareVersion: payload.firmwareVersion,
        iccid: payload.iccid,
        imsi: payload.imsi,
      });
      reply({ status: 'Accepted', currentTime: new Date().toISOString(), interval: 60 });
      sendWebhook('charger.boot', { chargePointId, ...store.getCharger(chargePointId) });
      break;
    }

    case 'Heartbeat': {
      store.updateHeartbeat(chargePointId);
      reply({ currentTime: new Date().toISOString() });
      sendWebhook('charger.heartbeat', { chargePointId, timestamp: new Date().toISOString() });
      break;
    }

    case 'StatusNotification': {
      const { connectorId, status, errorCode, vendorErrorCode, info } = payload;
      store.setConnectorStatus(chargePointId, connectorId, status, errorCode, vendorErrorCode, info);
      reply({});
      sendWebhook('connector.status', {
        chargePointId, connectorId, status,
        errorCode, vendorErrorCode, info,
        timestamp: payload.timestamp || new Date().toISOString(),
      });
      break;
    }

    case 'StartTransaction': {
      const { connectorId, idTag, meterStart, timestamp } = payload;
      const session = store.startSession(chargePointId, connectorId, idTag);
      session.meterStart = meterStart;
      session.startTime = timestamp || session.startTime;
      reply({ transactionId: session.transactionId, idTagInfo: { status: 'Accepted' } });
      sendWebhook('session.started', {
        chargePointId, connectorId,
        transactionId: session.transactionId,
        idTag, meterStart, startTime: session.startTime,
      });
      break;
    }

    case 'StopTransaction': {
      const { transactionId, meterStop, reason, idTag } = payload;
      const session = store.stopSession(transactionId, meterStop, reason || 'Local');
      reply({ idTagInfo: { status: 'Accepted' } });
      if (session) {
        sendWebhook('session.stopped', {
          chargePointId, transactionId, idTag, meterStop,
          meterStart: session.meterStart,
          energyDeliveredKwh: session.energyDeliveredKwh,
          startTime: session.startTime,
          endTime: session.endTime,
          reason: session.stopReason,
        });
      }
      break;
    }

    case 'MeterValues': {
      const { transactionId, connectorId, meterValue } = payload;
      const simplified = (meterValue || []).map(mv => ({
        timestamp: mv.timestamp,
        values: (mv.sampledValue || []).map(sv => ({
          measurand: sv.measurand || 'Energy.Active.Import.Register',
          value: parseFloat(sv.value),
          unit: sv.unit || 'Wh',
          context: sv.context,
          phase: sv.phase,
        })),
      }));
      if (transactionId) simplified.forEach(mv => store.addMeterValue(transactionId, mv.values));
      reply({});
      sendWebhook('session.meterValues', { chargePointId, connectorId, transactionId, meterValues: simplified });
      break;
    }

    case 'FirmwareStatusNotification': {
      const { status } = payload;
      store.addLog(chargePointId, 'firmware.status', { status });
      reply({});
      sendWebhook('firmware.status', { chargePointId, status, timestamp: new Date().toISOString() });
      break;
    }

    case 'DiagnosticsStatusNotification': {
      const { status } = payload;
      store.addLog(chargePointId, 'diagnostics.status', { status });
      reply({});
      sendWebhook('diagnostics.status', { chargePointId, status, timestamp: new Date().toISOString() });
      break;
    }

    case 'Authorize': {
      reply({ idTagInfo: { status: 'Accepted' } });
      break;
    }

    case 'DataTransfer': {
      reply({ status: 'Accepted' });
      break;
    }

    default: {
      log(chargePointId, `Action desconhecida: ${action}`);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify([4, uniqueId, 'NotImplemented', `Action '${action}' não suportada`, {}]));
      }
    }
  }
}

module.exports = { handleMessage, sendCall };
