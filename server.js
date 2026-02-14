require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db/database');

async function start() {
  // Initialize database (async for sql.js)
  await db.init();

  const app = express();
  const server = http.createServer(app);

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : undefined; // undefined = allow all (dev mode)
  const io = new Server(server, {
    cors: allowedOrigins ? { origin: allowedOrigins } : undefined
  });

  // Middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    }
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // Routes
  const adminRoutes = require('./routes/admin');
  const apiRoutes = require('./routes/api');
  const registerRoutes = require('./routes/register');

  app.use('/admin/api', adminRoutes);
  app.use('/api', apiRoutes);
  app.use('/api', registerRoutes);

  // Join URL redirect
  app.get('/join/:code', (req, res) => {
    res.redirect(`/?quiz=${req.params.code}`);
  });

  // Socket.IO
  const setupSockets = require('./sockets/index');
  const { answersVisibleAt } = setupSockets(io);

  // Make io and shared state accessible to routes
  app.set('io', io);
  app.set('answersVisibleAt', answersVisibleAt);
  global.answersVisibleAt = answersVisibleAt;

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    const admin = db.getAdminByUsername(process.env.ADMIN_USER || 'admin');
    console.log(`\n  Z-Quiz server running on http://localhost:${PORT}`);
    if (admin) {
      console.log(`  Join URL: http://localhost:${PORT}/join/${admin.quiz_code}`);
      console.log(`  Admin:    http://localhost:${PORT}/admin.html`);
      console.log(`  Presenter: http://localhost:${PORT}/presenter.html?quiz=${admin.quiz_code}\n`);
    }
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
