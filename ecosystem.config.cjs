/**
 * PM2 ecosystem config — mantiene el backend de Velocity Music vivo.
 *
 * Uso:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup    # sigue las instrucciones para auto-arranque con el OS
 *
 * Comandos útiles:
 *   pm2 status              # ver estado
 *   pm2 logs velocity-music # ver logs en vivo
 *   pm2 restart velocity-music  # reiniciar manualmente
 *   pm2 stop velocity-music     # detener
 */
module.exports = {
  apps: [{
    name: 'velocity-music',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    max_restarts: 20,
    min_uptime: '10s',
    max_memory_restart: '1G',
    restart_delay: 3000,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    // Cargar variables desde .env si existe.
    env_file: '.env',
  }],
};
