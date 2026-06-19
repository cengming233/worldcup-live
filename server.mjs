import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Proxy: m3u8 playlist - fetch and rewrite segment URLs
app.get('/proxy/m3u8', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    client.get(targetUrl, { timeout: 10000 }, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        return res.status(proxyRes.statusCode || 502).send('Upstream error: ' + proxyRes.statusCode);
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/vnd.apple.mpegurl');

      let data = '';
      proxyRes.on('data', (chunk) => { data += chunk.toString(); });
      proxyRes.on('end', () => {
        // Resolve relative URLs and proxy all absolute URLs
        const lines = data.split('\n');
        const rewritten = lines.map(line => {
          const trimmed = line.trim();
          // Skip comment lines and blank lines
          if (!trimmed || trimmed.startsWith('#')) return line;
          // Already proxied
          if (trimmed.startsWith('/proxy/')) return line;
          // Absolute URL → proxy it
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return '/proxy/ts?url=' + encodeURIComponent(trimmed);
          }
          // Relative URL → resolve against original m3u8 URL, then proxy
          try {
            const resolved = new URL(trimmed, targetUrl).href;
            return '/proxy/ts?url=' + encodeURIComponent(resolved);
          } catch(e) {
            return line;
          }
        });
        res.send(rewritten.join('\n'));
      });
    }).on('error', (err) => {
      console.error('Proxy m3u8 error:', err.message);
      if (!res.headersSent) res.status(502).send('Proxy error: ' + err.message);
    }).on('timeout', () => {
      if (!res.headersSent) res.status(504).send('Proxy timeout');
    });
  } catch (e) {
    if (!res.headersSent) res.status(400).send('Invalid URL: ' + e.message);
  }
});

// Proxy: TS segment / other media fragments
app.get('/proxy/ts', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    client.get(targetUrl, { timeout: 15000 }, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        return res.status(proxyRes.statusCode || 502).end();
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=10');

      proxyRes.pipe(res);
    }).on('error', (err) => {
      console.error('Proxy ts error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
  } catch (e) {
    res.status(400).send('Invalid URL: ' + e.message);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(`${__dirname}/worldcup-ai.html`);
});

createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
