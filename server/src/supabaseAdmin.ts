import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Fail loudly at startup rather than silently misbehaving on first request —
  // a missing env var here means every reminder run would silently do nothing.
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set these in Render → Environment ' +
    '(or your local .env for `npm run dev`). Use the SERVICE ROLE key, not the anon key — ' +
    'this client needs to read every user\'s habits, not just one.'
  );
}

// service-role key bypasses Row Level Security by design. Never expose this
// client, this key, or this file's logic to the mobile app.
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
