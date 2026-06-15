// webhook.js — envia eventos para a Lovable via HTTP POST

const WEBHOOK_URL = process.env.LOVABLE_WEBHOOK_URL;
const DEBUG = process.env.DEBUG === 'true';

async function sendWebhook(eventType, payload) {
  if (!WEBHOOK_URL) {
    if (DEBUG) console.log(`[Webhook] URL não configurada. Evento ignorado: ${eventType}`);
    return;
  }

  const body = JSON.stringify({
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OCPP-Event': eventType,
      },
      body,
    });
    if (DEBUG) console.log(`[Webhook] ${eventType} → ${res.status}`);
  } catch (err) {
    console.error(`[Webhook] Falha ao enviar ${eventType}:`, err.message);
  }
}

module.exports = { sendWebhook };
