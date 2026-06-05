import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Falta la variable de entorno requerida: ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  port: Number(process.env.PORT || 8787),
  gatewayToken: process.env.GATEWAY_TOKEN || "",
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || "52",
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS || 15000),
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 3),
  logLevel: process.env.LOG_LEVEL || "info",
  printQrTerminal: process.env.PRINT_QR_TERMINAL !== "false",
};
