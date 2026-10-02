import path from 'path';
import express from 'express';
import { sendReminders } from './sendReminders';

const app = express();
const PORT = process.env.PORT || 3000;
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  throw new Error(
    'Missing CRON_SECRET. Set it in Render → Environment, and use the exact same value ' +
    'as the header your external scheduler (cron-job.org) sends — this is what stops a ' +
    'stranger from finding your .onrender.com URL and spamming your users with pushes.'
  );
}

// 1. Resolve path to server/public directory
const publicPath = path.resolve(__dirname, '../public');

// 2. Serve static assets (CSS, JS, images) from server/public
app.use(express.static(publicPath));

// 3. Serve index.html on root GET request for portfolio visitors
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Render's free web services spin down after ~15 min idle and cold-start
// on the next request — that's fine here, since the external scheduler's
// ping IS the next request. This route intentionally does no auth/session
// work, so a cold start is just "npm start, then this one query."
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/trigger-reminders', async (req, res) => {
  if (req.get('x-cron-secret') !== CRON_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const result = await sendReminders();
    console.log('[trigger-reminders]', JSON.stringify(result));
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[trigger-reminders] failed:', message);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`habit-tracker-server listening on :${PORT}`);
});
