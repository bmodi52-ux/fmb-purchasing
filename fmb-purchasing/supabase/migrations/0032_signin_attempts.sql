-- Failed sign-ins, counted.
--
-- The forgot-password endpoint has had a careful two-ceiling throttle since
-- 0019 — one per address, one per IP, defending against inbox flooding and
-- account enumeration respectively. Sign-in had nothing of our own, relying
-- entirely on whatever the auth provider does by default.
--
-- That is a thin place to leave the door someone would actually try. Passwords
-- here are chosen by their owners and only have to satisfy a length and
-- character rule, so an attacker who knows one address — and addresses are
-- ordinary community ones — has a guessing budget worth capping.
--
-- Same shape and same pruning as password_reset_attempts, deliberately: one
-- throttling pattern in this codebase rather than two.
--
-- Only failures are recorded. A successful sign-in clears the address's
-- history, so somebody who mistypes their password four times and then gets it
-- right is not carrying those four attempts around for the next hour.

create table signin_attempts (
  id uuid primary key default gen_random_uuid(),
  -- Not a foreign key: an attempt against an address with no account is
  -- exactly the case worth counting, and the table must never become a way to
  -- ask which addresses exist.
  email text not null,
  ip text,
  attempted_at timestamptz not null default now()
);

create index signin_attempts_email_idx on signin_attempts (email, attempted_at desc);
create index signin_attempts_ip_idx on signin_attempts (ip, attempted_at desc) where ip is not null;

comment on table signin_attempts is
  'Failed sign-in attempts, for rate limiting. Cleared for an address on '
  'successful sign-in, and pruned past the retention window by the next request.';

alter table signin_attempts enable row level security;
