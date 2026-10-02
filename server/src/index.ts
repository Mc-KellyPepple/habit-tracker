import path from 'path';
import express from 'express';
import { sendReminders } from './sendReminders';

const app = express();

const PORT = Number(process.env.PORT) || 10000;
const CRON_SECRET = process.env.CRON_SECRET;

const publicPath = path.resolve(__dirname, '../public');

app.use(express.json());
app.use(express.static(publicPath));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'habit-tracker-server',
  });
});

app.post('/trigger-reminders', async (req, res) => {
  if (!CRON_SECRET) {
    res.status(503).json({
      error: 'CRON_SECRET is not configured',
    });
    return;
  }

  if (req.get('x-cron-secret') !== CRON_SECRET) {
    res.status(401).json({
      error: 'unauthorized',
    });
    return;
  }

  try {
    const result = await sendReminders();

    console.log(
      '[trigger-reminders]',
      JSON.stringify(result)
    );

    res.status(200).json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);

    console.error(
      '[trigger-reminders] failed:',
      message
    );

    res.status(500).json({
      error: message,
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `habit-tracker-server listening on 0.0.0.0:${PORT}`
  );
});
