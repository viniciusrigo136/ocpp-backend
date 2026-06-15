# OCPP 1.6 Backend

Backend para gestão de carregadores veiculares via OCPP 1.6, com API REST para integração com a Lovable.

---

## Arquitetura

```
Carregador EV  ──(WebSocket OCPP 1.6)──►  Backend  ──(REST API / Webhook)──►  Lovable
```

- **WebSocket OCPP:** `ws://<host>/ocpp/<chargePointId>`
- **REST API:** `http://<host>/api/...`
- **Webhooks:** o backend notifica a Lovable em tempo real a cada evento OCPP

---

## Deploy Gratuito

### Opção 1: Railway (recomendado)

1. Crie conta em https://railway.app
2. Clique em **New Project → Deploy from GitHub repo**
3. Faça push deste código para um repo GitHub
4. Railway detecta o `Procfile` automaticamente
5. Em **Variables**, adicione:
   - `API_SECRET_TOKEN=seu-token`
   - `LOVABLE_WEBHOOK_URL=https://seu-projeto.lovable.app/api/ocpp-events`
   - `DEBUG=true`
6. Deploy automático! A URL pública será algo como `https://ocpp-backend-xxx.railway.app`

### Opção 2: Render

1. Crie conta em https://render.com
2. **New → Web Service → Connect GitHub**
3. Build Command: `npm install`
4. Start Command: `node src/index.js`
5. Adicione as mesmas variáveis de ambiente acima

### Opção 3: Docker (VPS própria)

```bash
docker build -t ocpp-backend .
docker run -d -p 3000:3000 \
  -e API_SECRET_TOKEN=seu-token \
  -e LOVABLE_WEBHOOK_URL=https://... \
  -e DEBUG=true \
  ocpp-backend
```

---

## Configurar o Carregador

No painel do carregador, defina o **OCPP Central System URL**:

```
ws://sua-url.railway.app/ocpp/MEU_CARREGADOR_001
```

> O ID no final da URL (`MEU_CARREGADOR_001`) é o `chargePointId` que identifica o carregador no sistema.

---

## API REST

Todas as rotas usam o header de autenticação:
```
X-Api-Token: seu-token-secreto
```

### Carregadores

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Health check |
| GET | `/api/chargers` | Lista todos os carregadores |
| GET | `/api/chargers/:id` | Detalhes de um carregador |

### Sessões

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/sessions` | Lista sessões (query: `?chargePointId=xxx`) |
| GET | `/api/sessions/:transactionId` | Detalhes de uma sessão |

### Comandos (enviados ao carregador)

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| POST | `/api/chargers/:id/remote-start` | `{ connectorId, idTag }` | Inicia carregamento |
| POST | `/api/chargers/:id/remote-stop` | `{ transactionId }` | Para carregamento |
| POST | `/api/chargers/:id/reset` | `{ type: "Soft"\|"Hard" }` | Reinicia carregador |
| POST | `/api/chargers/:id/unlock-connector` | `{ connectorId }` | Desbloqueia conector |
| POST | `/api/chargers/:id/change-availability` | `{ connectorId, type }` | Ativa/desativa conector |
| POST | `/api/chargers/:id/get-configuration` | `{ key? }` | Lê configuração OCPP |
| POST | `/api/chargers/:id/change-configuration` | `{ key, value }` | Altera configuração OCPP |

---

## Webhooks para a Lovable

Configure `LOVABLE_WEBHOOK_URL` e o backend enviará POST para cada evento:

### Eventos disponíveis

#### `charger.boot`
```json
{
  "event": "charger.boot",
  "timestamp": "2024-01-15T10:00:00Z",
  "data": {
    "chargePointId": "CP001",
    "status": "Connected",
    "info": { "vendor": "ABB", "model": "Terra", "firmwareVersion": "1.2.3" }
  }
}
```

#### `charger.heartbeat`
```json
{
  "event": "charger.heartbeat",
  "data": { "chargePointId": "CP001", "timestamp": "2024-01-15T10:01:00Z" }
}
```

#### `connector.status`
```json
{
  "event": "connector.status",
  "data": {
    "chargePointId": "CP001",
    "connectorId": 1,
    "status": "Charging",
    "errorCode": "NoError"
  }
}
```

#### `session.started`
```json
{
  "event": "session.started",
  "data": {
    "chargePointId": "CP001",
    "connectorId": 1,
    "transactionId": 1001,
    "idTag": "ABC123",
    "meterStart": 0,
    "startTime": "2024-01-15T10:05:00Z"
  }
}
```

#### `session.stopped`
```json
{
  "event": "session.stopped",
  "data": {
    "chargePointId": "CP001",
    "transactionId": 1001,
    "meterStart": 0,
    "meterStop": 15000,
    "energyDeliveredKwh": 15.0,
    "startTime": "2024-01-15T10:05:00Z",
    "endTime": "2024-01-15T11:05:00Z",
    "reason": "Local"
  }
}
```

#### `session.meterValues`
```json
{
  "event": "session.meterValues",
  "data": {
    "chargePointId": "CP001",
    "transactionId": 1001,
    "meterValues": [
      {
        "timestamp": "2024-01-15T10:10:00Z",
        "values": [{ "measurand": "Power.Active.Import", "value": 7200, "unit": "W" }]
      }
    ]
  }
}
```

---

## Integração na Lovable

Na Lovable, crie um endpoint de webhook (ex: em Supabase Edge Functions):

```typescript
// supabase/functions/ocpp-events/index.ts
Deno.serve(async (req) => {
  const event = await req.json();
  
  switch (event.event) {
    case 'session.started':
      // Salvar sessão no banco
      await supabase.from('sessions').insert(event.data);
      break;
    case 'session.stopped':
      // Atualizar sessão com energia entregue
      await supabase.from('sessions')
        .update({ energy_kwh: event.data.energyDeliveredKwh, end_time: event.data.endTime })
        .eq('transaction_id', event.data.transactionId);
      break;
    case 'connector.status':
      // Atualizar status do conector
      await supabase.from('chargers')
        .update({ status: event.data.status })
        .eq('charge_point_id', event.data.chargePointId);
      break;
  }
  
  return new Response('ok');
});
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `PORT` | Não | Porta do servidor (padrão: 3000) |
| `API_SECRET_TOKEN` | Recomendada | Token para proteger a API REST |
| `LOVABLE_WEBHOOK_URL` | Não | URL para notificações em tempo real |
| `DEBUG` | Não | Logs detalhados (`true`/`false`) |

---

## Desenvolvimento Local

```bash
npm install
cp .env.example .env
# edite .env com seus valores
npm run dev
```
