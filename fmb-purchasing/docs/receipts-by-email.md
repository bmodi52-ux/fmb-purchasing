# Receipts by email

Members can forward a receipt email, or send a photo or PDF as an attachment, to one address. It waits on their
**Submit** page, with a notification, until they check what was read and submit it or dismiss it. Nothing is
submitted for them.

## How it works

1. An email service receives mail for the address and posts each message, whole, to
   `https://www.fmbpurchasing.com.au/api/inbound-email`.
2. The app matches the sender's address to a member's contact email (as on Admin → Users). Messages from anyone
   else, from an address two accounts share, or from someone who can't submit expenses are dropped. A message the
   service marks as failing DMARC is dropped too.
3. The message is kept as a receipt file (the same `.eml` upload Submit already accepts) and listed on that
   member's Submit page. **Read and submit** reads it the way an upload is read.
4. When the expense is submitted, the emailed receipt leaves the list on its own.

A request body over about 4.5 MB is refused by Vercel before the app sees it, so a very large attachment should be
uploaded on Submit instead.

## Settings

| Variable | What it does |
| --- | --- |
| `INBOUND_EMAIL_SECRET` | A long random string the email service sends with each message. Without it every post is refused. |
| `INBOUND_EMAIL_ADDRESS` | The address to show members on Submit, e.g. `receipts@fmbpurchasing.com.au`. Optional. |

The secret can be sent as an `x-inbound-secret` header, as `Authorization: Bearer <secret>`, or as `?key=<secret>`
on the URL for services that only take a URL.

## Option A: Cloudflare Email Routing (free)

Needs the domain's DNS on Cloudflare.

1. Cloudflare → the domain → **Email** → **Email Routing** → enable it (it adds the MX records).
2. **Email Workers** → create a worker with the code below, and add `INBOUND_EMAIL_SECRET` to its settings as a
   secret.
3. **Routing rules** → custom address `receipts@…` → action **Send to a Worker** → the worker.

```js
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const response = await fetch("https://www.fmbpurchasing.com.au/api/inbound-email", {
      method: "POST",
      headers: { "content-type": "message/rfc822", "x-inbound-secret": env.INBOUND_EMAIL_SECRET },
      body: raw,
    });
    if (!response.ok) {
      message.setReject("The receipt couldn't be taken just now. Upload it on the Submit page instead.");
      return;
    }
    const { status } = await response.json();
    if (status === "unknown_sender" || status === "not_allowed") {
      message.setReject("This address only takes receipts from FMB members, sent from their own email address.");
    }
  },
};
```

## Option B: SendGrid Inbound Parse

Works with DNS anywhere, on a subdomain so the main domain's mail is untouched.

1. Add an MX record for a subdomain, e.g. `in.fmbpurchasing.com.au` → `mx.sendgrid.net` (priority 10).
2. SendGrid → Settings → **Inbound Parse** → add the subdomain, with the destination URL
   `https://www.fmbpurchasing.com.au/api/inbound-email?key=<INBOUND_EMAIL_SECRET>`, and tick
   **POST the raw, full MIME message**.
3. The address is then anything at the subdomain, e.g. `receipts@in.fmbpurchasing.com.au`.

## Checking it

Send a receipt from a member's contact address. It should appear on that member's Submit page within a minute. If it
doesn't, System errors shows any failure under `inbound-email`; a message from an unknown address leaves no trace by
design.
