// index.js — ponto de entrada do servidor OCPP + REST API

require('dotenv').config();

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const url = require('url');

const store = require('./store');
const { handleMessage } = require('./ocppHandler');
const apiRouter = require('./api');

const PORT = process.env.PORT || 3000;
const DEBUG = process.env.DEBUG === 'true';

// ─── Express + HTTP server ────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json());

// Rota raiz com status geral
app.get('/', (_req, res) => {
  const chargers = store.getAllChargers();
  res.json({
    service: 'OCPP 1.6 Backend',
    version: '1.0.0',
    websocketEndpoint: `ws://<host>/ocpp/<chargePointId>`,
    chargersOnline: chargers.filter(c => c.online).length,
    chargersTotal: chargers.length,
    timestamp: new Date().toISOString(),
  });
});

// Rotas da API REST
app.use('/api', apiRouter);

const server = http.createServer(app);

// ─── WebSocket Server para OCPP 1.6 ──────────────────────────────────────────
// URL esperada pelo carregador: ws://<host>/ocpp/<chargePointId>
const wss = new WebSocketServer({
  server,
  handleProtocols: (protocols) => {
    // OCPP 1.6 usa subprotocolo "ocpp1.6"
    if (protocols.has('ocpp1.6')) return 'ocpp1.6';
    return false;
  },
});

wss.on('connection', (ws, req) => {
  // Extrai o chargePointId da URL: /ocpp/CP001
  const pathname = url.parse(req.url).pathname;
  const parts = pathname.split('/').filter(Boolean);
  const chargePointId = parts[parts.length - 1];

  if (!chargePointId || parts[0] !== 'ocpp') {
    console.warn(`[WS] Conexão rejeitada — URL inválida: ${req.url}`);
    ws.close(1008, 'URL inválida. Use /ocpp/<chargePointId>');
    return;
  }

  console.log(`[WS] Carregador conectado: ${chargePointId} (${req.socket.remoteAddress})`);
  store.setChargerWs(chargePointId, ws);

  ws.on('message', (data) => {
    handleMessage(chargePointId, data.toString());
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Carregador desconectado: ${chargePointId} (${code})`);
    store.removeChargerWs(chargePointId);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Erro no carregador ${chargePointId}:`, err.message);
  });

  // Ping a cada 30s para manter conexão viva
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);
});

// ─── Inicia o servidor ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║         OCPP 1.6 Backend rodando!                ║
╠══════════════════════════════════════════════════╣
║  REST API  →  http://localhost:${PORT}/api           ║
║  OCPP WS   →  ws://localhost:${PORT}/ocpp/<id>       ║
╚══════════════════════════════════════════════════╝
  `);
  if (DEBUG) console.log('[Debug] Logs detalhados ativados');
});
