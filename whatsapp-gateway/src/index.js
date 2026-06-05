import express from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { supabase } from "./supabase.js";
import { startSocket, logout, onReady } from "./whatsapp.js";
import { startOutboxLoop, processOutbox } from "./outbox.js";

// Atiende comandos pedidos desde el panel (p. ej. desvincular).
async function pollCommands() {
  const { data, error } = await supabase.rpc("wp_gw_connection_get");
  if (error) {
    logger.error({ err: error.message }, "no se pudo leer el estado de conexion");
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.command === "logout") {
    logger.info("comando 'logout' recibido desde el panel");
    await logout();
  }
}

function startHttp() {
  const app = express();

  app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  app.get("/status", async (req, res) => {
    if (config.gatewayToken) {
      const header = req.headers.authorization || "";
      if (header !== `Bearer ${config.gatewayToken}`) {
        return res.status(401).json({ error: "unauthorized" });
      }
    }
    const { data, error } = await supabase.rpc("wp_gw_connection_get");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ connection: Array.isArray(data) ? data[0] : data });
  });

  app.listen(config.port, () => logger.info({ port: config.port }, "HTTP escuchando"));
}

async function main() {
  logger.info("Iniciando Kadmiel WhatsApp gateway");

  // Al conectar, vaciar lo que se haya encolado mientras estaba offline.
  onReady(() => processOutbox().catch((err) => logger.error({ err: err?.message }, "error procesando cola al conectar")));

  await startSocket();
  startOutboxLoop();
  setInterval(() => pollCommands().catch((err) => logger.error({ err: err?.message }, "error en pollCommands")), 5000);
  startHttp();
}

main().catch((err) => {
  logger.error({ err: err?.message }, "fallo fatal del gateway");
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    logger.info({ signal }, "apagando gateway");
    process.exit(0);
  });
}
