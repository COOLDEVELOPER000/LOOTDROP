-- ─────────────────────────────────────────────────────────────────
-- LootDrop — Cron setup  (run ONCE in SQL Editor, AFTER deploying the
-- sync-games Edge Function). Free-tier compatible.
-- ─────────────────────────────────────────────────────────────────

-- 1. Enable the scheduling + HTTP extensions (available on all plans)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Store the function URL + key in Vault (never hardcode them).
--    Replace YOUR_PROJECT_REF and YOUR_PUBLISHABLE_KEY.
--    The publishable (anon-equivalent) key is enough to invoke the
--    function; the function itself holds the service-role key as a secret.
SELECT vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-games',
  'lootdrop_fn_url'
);
SELECT vault.create_secret(
  'YOUR_PUBLISHABLE_KEY',
  'lootdrop_fn_key'
);

-- 3. Schedule it. Hourly is ~720 invocations/month — far under the
--    free-tier cap, and never misses a Steam promo (those run >=24h).
--    Epic timing is exact regardless, because windows are stored.
SELECT cron.schedule(
  'lootdrop-sync',
  '0 * * * *',                       -- top of every hour (UTC)
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lootdrop_fn_url'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lootdrop_fn_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Useful management queries:
--   SELECT * FROM cron.job;                              -- list jobs
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--   SELECT cron.unschedule('lootdrop-sync');             -- remove job
--   SELECT * FROM public.sync_log ORDER BY ran_at DESC LIMIT 10;  -- sync history
