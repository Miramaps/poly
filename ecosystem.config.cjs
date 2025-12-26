module.exports = {
  apps: [
    {
      name: 'poly-bot',
      script: 'dist/index.js',
      cwd: './apps/bot',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        BOT_PORT: 3001,
      },
      error_file: './logs/bot-error.log',
      out_file: './logs/bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'poly-dashboard',
      script: 'npm',
      args: 'start',
      cwd: './apps/dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        DASHBOARD_PORT: 3000,
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
        NEXT_PUBLIC_WS_URL: 'ws://localhost:3001',
      },
      error_file: './logs/dashboard-error.log',
      out_file: './logs/dashboard-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};


