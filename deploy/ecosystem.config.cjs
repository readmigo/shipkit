/**
 * PM2 Ecosystem Configuration for ShipKit
 *
 * Usage:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 reload deploy/ecosystem.config.cjs
 *   pm2 stop shipkit-web
 */

module.exports = {
  apps: [
    {
      name: 'shipkit-web',
      script: 'dist/web/server.js',
      cwd: '/home/readmigo/shipkit',
      node_args: '--enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        SHIPKIT_WEB_PORT: '3456',
        SHIPKIT_DB_PATH: '/home/readmigo/.shipkit/jobs.db',
        SHIPKIT_LOG_LEVEL: 'info',
      },
      // Logs
      error_file: '/home/readmigo/.shipkit/logs/error.log',
      out_file: '/home/readmigo/.shipkit/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
