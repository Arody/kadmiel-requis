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
      if (!isConnected()) break;
      const { data: claimed, error } = await supabase.rpc("wp_gw_claim_messages_v2", {
        p_limit: 1,
        p_max: config.maxAttempts,
      });
      if (error) {
        logger.error({ err: error.message }, "no se pudo reclamar de la cola");
        break;
      }
      if (!claimed || claimed.length === 0) break;

      for (const msg of claimed) {
        try {
          await sendText(msg.to_phone, msg.body, String(msg.id).replaceAll("-", "").toUpperCase());
          const { data: markedSent, error: markSentError } = await supabase.rpc("wp_gw_mark_sent_v2", {
            p_id: msg.id,
            p_claim_token: msg.claim_token,
          });
          if (markSentError) throw new Error(`no se pudo confirmar el envio: ${markSentError.message}`);
          if (!markedSent) throw new Error("el lease de envio vencio antes de poder confirmarlo");
          logger.info({ id: msg.id, to: msg.to_phone }, "mensaje enviado");
        } catch (err) {
          const errMsg = String(err?.message || err).slice(0, 500);
          const { data: markedFailed, error: markFailedError } = await supabase.rpc("wp_gw_mark_failed_v2", {
            p_id: msg.id,
            p_claim_token: msg.claim_token,
            p_error: errMsg,
            p_max: config.maxAttempts,
          });
          if (markFailedError || !markedFailed) {
            logger.error(
              { id: msg.id, err: markFailedError?.message ?? "lease vencido" },
              "no se pudo devolver el mensaje a la cola",
            );
          }
          logger.warn({ id: msg.id, to: msg.to_phone, err: errMsg }, "mensaje fallido");
          break;
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
