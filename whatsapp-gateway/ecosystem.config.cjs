// PM2 — un solo proceso (una sola sesion de WhatsApp).
module.exports = {
  apps: [
    {
      name: "kadmiel-whatsapp-gateway",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
