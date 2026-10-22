-- Web Push for the Habit Tracker web app.
-- ADDITIVE ONLY: creates one new table and two small functions.
-- Does not touch habits, checkins, push_tokens, reminder_deliveries, the
-- scheduler, or any existing function. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_id_idx
  ON public.web_push_subscriptions (user_id);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can see and remove only their own subscriptions.
-- (Creating/updating goes through register_web_push_subscription below, so a
-- browser that switches accounts can be re-bound safely.)
DROP POLICY IF EXISTS web_push_subscriptions_select_own ON public.web_push_subscriptions;
CREATE POLICY web_push_subscriptions_select_own ON public.web_push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS web_push_subscriptions_delete_own ON public.web_push_subscriptions;
CREATE POLICY web_push_subscriptions_delete_own ON public.web_push_subscriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON public.web_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.web_push_subscriptions TO authenticated;
GRANT ALL ON public.web_push_subscriptions TO service_role;

-- Register (or re-bind) this browser's subscription to the signed-in user.
-- A push endpoint identifies one browser profile, so if someone else signs in
-- on the same browser the subscription moves to them.
CREATE OR REPLACE FUNCTION public.register_web_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;
  IF coalesce(p_endpoint, '') = '' OR coalesce(p_p256dh, '') = '' OR coalesce(p_auth, '') = '' THEN
    RAISE EXCEPTION 'invalid subscription' USING ERRCODE = '22023';
  END IF;
  IF p_endpoint !~ '^https://' THEN
    RAISE EXCEPTION 'endpoint must be https' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.web_push_subscriptions AS s (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.register_web_push_subscription(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_web_push_subscription(text, text, text, text) TO authenticated;

COMMIT;
