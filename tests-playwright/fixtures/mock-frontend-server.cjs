/**
 * Mock Frontend Server for testing Volto Hydra admin UI.
 * Serves the test frontend static files with hydra.js bridge.
 *
 * Run directly: node mock-frontend-server.cjs
 * Or started automatically by Playwright global setup
 */

const express = require('express');
const path = require('path');

const app = express();
const { requiredPort, requiredOrigin } = require('./env-port.cjs');

const PORT = requiredPort('PORT');
// Told which API it talks to, never assuming: see env-port.cjs.
const API_URL = process.env.API_URL || requiredOrigin('HYDRA_MOCK_API_PORT');
const FRONTEND_DIR = path.join(__dirname, 'test-frontend');

// Enable CORS and allow iframe embedding
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Allow embedding in iframe from any origin
  res.removeHeader('X-Frame-Options');
  res.header('Content-Security-Policy', 'frame-ancestors *');
  next();
});

// Proxy /api/* requests to the mock API server
// The frontend JavaScript will call /api/content which gets proxied to the mock API
app.use('/api', async (req, res) => {
  try {
    const apiPath = req.url; // Already includes path and query string
    const url = `${API_URL}${apiPath}`;

    if (process.env.DEBUG) {
      console.log(`[FRONTEND PROXY] ${req.method} ${req.url} -> ${url}`);
    }

    // Forward headers
    const headers = {};
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    const response = await fetch(url, {
      method: req.method,
      headers,
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error(`[FRONTEND PROXY ERROR] ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Serve static frontend files
app.use(express.static(FRONTEND_DIR));

// Fallback to index.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Mock frontend server running on http://localhost:${PORT}`);
  console.log(`Connecting to API at ${API_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down frontend server');
  server.close(() => {
    console.log('Frontend server closed');
    process.exit(0);
  });
});

// Export the HTTP server instance for proper teardown
module.exports = server;
