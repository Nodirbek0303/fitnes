"use strict";

const { createRuntime } = require("../server");

const runtime = createRuntime();
let webhookSetup;

module.exports = async function handler(request, response) {
  try {
    await runtime.ready;
    if (process.env.VERCEL && process.env.TELEGRAM_BOT_TOKEN &&
        process.env.TELEGRAM_WEBHOOK_SECRET && process.env.PUBLIC_APP_URL) {
      if (!webhookSetup) {
        webhookSetup = runtime.configureTelegramWebhook().catch((error) => {
          webhookSetup = null;
          console.error("Telegram webhook sozlanmadi: " + error.message);
          return false;
        });
      }
      await webhookSetup;
    }
    await runtime.handler(request, response);
  } catch (error) {
    console.error("Vercel API ishga tushmadi: " + error.message);
    response.statusCode = 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({ error: "Server ishga tushmadi. Sozlamalarni tekshiring." }));
  }
};
