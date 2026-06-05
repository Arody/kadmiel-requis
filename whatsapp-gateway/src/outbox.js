import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { sendText, isConnected } from "./whatsapp.js";

let processing = false;

/** Reclama y envia todos los mensajes pendientes de la cola. Idempotente y seguro de re-entrar. */
export async function processOutbox() {
  if (processing) return;
  if (!isConnected()) return; // sin conexion no se envia; el barrido reintentara
  processing = true;

  try {
    for (;;) {
      const { data: claimed, error } = await supabase.rpc("wp_gw_claim_messages", { p_limit: 10 });
      if (error) {
        logger.error({ err: error.message }, "no se pudo reclamar de la cola");
        break;
      }
      if (!claimed || claimed.length === 0) break;

      for (const msg of claimed) {
        try {
          await sendText(msg.to_phone, msg.body);
          await supabase.rpc("wp_gw_mark_sent", { p_id: msg.id });
          logger.info({ id: msg.id, to: msg.to_phone }, "mensaje enviado");
        } catch (err) {
          const errMsg = String(err?.message || err).slice(0, 500);
          await supabase.rpc("wp_gw_mark_failed", {
            p_id: msg.id,
            p_error: errMsg,
            p_max: config.maxAttempts,
          });
          logger.warn({ id: msg.id, to: msg.to_phone, err: errMsg }, "mensaje fallido");
        }
      }
    }
  } finally {
    processing = false;
  }
}

export function startOutboxLoop() {
  // Barrido periodico: garantiza la entrega aunque Realtime no llegue.
  setInterval(() => {
    processOutbox().catch((err) => logger.error({ err: err?.message }, "error en el barrido"));
  }, config.sweepIntervalMs);

  // Acelerador best-effort via Realtime: enviar al instante al encolarse.
  try {
    supabase
      .channel("wp_outbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "wp_data", table: "message_outbox" },
        () => {
          processOutbox().catch((err) => logger.error({ err: err?.message }, "error en trigger realtime"));
        },
      )
      .subscribe((status) => logger.info({ status }, "suscripcion realtime a la cola"));
  } catch (err) {
    logger.warn({ err: err?.message }, "no se pudo suscribir a Realtime; se usara solo el barrido");
  }
}
