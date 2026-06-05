import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { useSupabaseAuthState } from "./authState.js";

let sock = null;
let auth = null;
let starting = false;
let readyCallback = null;

async function setConnection(fields) {
  const { error } = await supabase.rpc("wp_gw_connection_set", fields);
  if (error) logger.error({ err: error.message }, "no se pudo guardar el estado de conexion");
}

export function isConnected() {
  return Boolean(sock?.user);
}

export function onReady(cb) {
  readyCallback = cb;
}

export async function startSocket() {
  if (starting || sock) return;
  starting = true;

  try {
    auth = await useSupabaseAuthState();

    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      logger.warn("no se pudo obtener la version de WhatsApp; se usa la incluida en Baileys");
    }

    sock = makeWASocket({
      version,
      auth: {
        creds: auth.state.creds,
        keys: makeCacheableSignalKeyStore(auth.state.keys, logger),
      },
      logger,
      browser: ["Kadmiel Supply OS", "Chrome", "1.0.0"],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", auth.saveCreds);
    sock.ev.on("connection.update", handleConnectionUpdate);
  } catch (err) {
    logger.error({ err: err?.message }, "fallo al iniciar el socket");
    sock = null;
    setTimeout(() => startSocket().catch(() => {}), 5000);
  } finally {
    starting = false;
  }
}

async function handleConnectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    logger.info("QR disponible: escanealo desde la pestana Ajustes o la terminal");
    if (config.printQrTerminal) qrcodeTerminal.generate(qr, { small: true });
    // Renderizamos el QR a PNG (data URL) para que el frontend solo lo muestre
    // con <img>, sin librerias de QR en el navegador.
    let qrImage = null;
    try {
      qrImage = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    } catch (err) {
      logger.warn({ err: err?.message }, "no se pudo renderizar el QR a imagen");
    }
    await setConnection({ p_status: "qr", p_qr: qrImage, p_phone: null });
  }

  if (connection === "connecting") {
    await setConnection({ p_status: "connecting", p_qr: null, p_phone: null });
  }

  if (connection === "open") {
    const phone = sock?.user?.id ? sock.user.id.split(":")[0].split("@")[0] : null;
    logger.info({ phone }, "WhatsApp conectado");
    await setConnection({
      p_status: "connected",
      p_qr: null,
      p_phone: phone,
      p_clear_command: true,
    });
    if (readyCallback) readyCallback();
  }

  if (connection === "close") {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    logger.warn({ statusCode, loggedOut }, "conexion cerrada");
    sock = null;

    if (loggedOut) {
      if (auth) await auth.clearAll().catch(() => {});
      await setConnection({ p_status: "disconnected", p_qr: null, p_phone: null });
      setTimeout(() => startSocket().catch(() => {}), 2000);
    } else {
      await setConnection({ p_status: "connecting", p_qr: null, p_phone: null });
      setTimeout(() => startSocket().catch(() => {}), 3000);
    }
  }
}

/** Cierra la sesion (desvincular), limpia las credenciales y reinicia para un QR nuevo. */
export async function logout() {
  try {
    if (sock) await sock.logout().catch(() => {});
  } finally {
    if (auth) await auth.clearAll().catch(() => {});
    sock = null;
    await setConnection({
      p_status: "disconnected",
      p_qr: null,
      p_phone: null,
      p_clear_command: true,
    });
    setTimeout(() => startSocket().catch(() => {}), 1500);
  }
}

/** Envia un mensaje de texto. Resuelve el JID con onWhatsApp (maneja el "1" de MX). */
export async function sendText(phone, body) {
  if (!sock?.user) throw new Error("WhatsApp no esta conectado");

  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) throw new Error(`Telefono invalido: ${phone}`);

  let jid = `${digits}@s.whatsapp.net`;
  try {
    const results = await sock.onWhatsApp(digits);
    const hit = results?.[0];
    if (hit?.exists && hit.jid) jid = hit.jid;
    else if (hit && hit.exists === false) throw new Error(`El numero ${digits} no tiene WhatsApp`);
  } catch (err) {
    if (String(err?.message).includes("no tiene WhatsApp")) throw err;
    logger.warn({ err: err?.message }, "onWhatsApp fallo; se intenta con el JID directo");
  }

  await sock.sendMessage(jid, { text: body });
}
