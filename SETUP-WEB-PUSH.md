# Web Push setup (habit-tracker repo)

Already done for you: the database table and function were added to your Supabase
project (supabase/web_push_subscriptions.sql is included for the repo record only,
do NOT run it again unless you rebuild the database).

## 1. Generate your keys (on your PC, so the private key never leaves it)
In PowerShell, from any folder with Node installed:

    npx web-push generate-vapid-keys

You get a Public Key and a Private Key. Keep the private one secret.

## 2. Render: add 3 environment variables (Render -> your service -> Environment)
    VAPID_PUBLIC_KEY   = <public key>
    VAPID_PRIVATE_KEY  = <private key>
    VAPID_SUBJECT      = mailto:mckelly2014@gmail.com
Save. (With these absent, the server behaves exactly as before.)

## 3. Vercel: add 1 environment variable (habit-tracker-web -> Settings -> Environment Variables)
    VITE_VAPID_PUBLIC_KEY = <the same PUBLIC key>
Never put the private key in Vercel.

## 4. Push the code (use your habit-tracker-clean folder)
Copy the contents of this zip over habit-tracker-clean (same paths), then:

    git status      (expect: server/src/sendReminders.ts, server/package.json,
                     server/package-lock.json, server/.env.example,
                     web/index.html, web/src/App.tsx, web/src/App.css,
                     modified; NEW: server/src/webPush.ts, web/src/ReminderPanel.tsx,
                     web/src/lib/push.ts, web/public/*, supabase/web_push_subscriptions.sql,
                     SETUP-WEB-PUSH.md)
    git add server web supabase
    git commit -m "Add Web Push reminders for the web app"
    git push

Render rebuilds the server; Vercel rebuilds the web app. If you added the Vercel
variable AFTER the first build, click Redeploy on the latest deployment.

## 5. Test it (Android + Chrome)
1. Open the web app on your phone, sign in.
2. In "Phone reminders" tap Enable reminders and allow notifications. Tap Send test.
3. Add a habit with the reminder time set to the CURRENT hour, leave it unchecked.
4. In Supabase -> SQL Editor run:   select public.trigger_due_habit_reminders();
5. Within seconds the notification should appear (the server may need up to a minute
   to wake). Checking the habit in first should result in no notification.
Normally reminders go out on the hour automatically.
