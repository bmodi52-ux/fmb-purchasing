-- Throttles the forgot-password endpoint.
--
-- The reset flow mints its token with the service-role generateLink rather
-- than the client-side resetPasswordForEmail, which means GoTrue's own
-- per-address rate limiting never applies. Left unthrottled, a loop against
-- /forgot-password would flood a real person's inbox and burn the Resend
-- quota, and would let someone sweep addresses to see which ones exist.
--
-- Deliberately a table rather than an in-process counter: the app runs on
-- serverless functions, so a Map in module scope is per-instance, resets
-- constantly, and throttles nothing.

create table password_reset_attempts (
  id bigint generated always as identity primary key,
  -- normalised lowercase, recorded whether or not an account exists — the
  -- endpoint must behave identically either way
  email text not null,
  -- best-effort: absent when no forwarded-for header reaches the function
  ip text,
  requested_at timestamptz not null default now()
);

-- Both limits are "this key, within the last hour", counted on every request
-- to the endpoint, so both want a covering index.
create index password_reset_attempts_email_idx
  on password_reset_attempts (email, requested_at desc);
create index password_reset_attempts_ip_idx
  on password_reset_attempts (ip, requested_at desc)
  where ip is not null;

alter table password_reset_attempts enable row level security;

comment on table password_reset_attempts is
  'Rate-limit ledger for /forgot-password. Rows older than a day are pruned opportunistically by the action itself; nothing reads them after the window closes.';
