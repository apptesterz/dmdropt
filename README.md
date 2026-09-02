# dmdrop

Instagram DM automation you run on your own hosting. Someone comments your
keyword, they get a DM with your link, within seconds.

You bought a licence, not a subscription. This runs on **your** Cloudflare
account, holds **your** data, and costs nothing per month on Cloudflare's free
tier.

---

## Install

### 1. Get your two keys

Open **https://connect.dmdrop.in/keys** and keep that tab open. It generates two
secret values in your own browser — we never see them. You will paste them in a
moment.

### 2. Sign in first — this matters

Before you tap anything, open these two and sign in (or create free accounts):

- **https://dash.cloudflare.com**
- **https://github.com**

Do this **first**, in the same browser. If you are not already signed in, the
deploy page sends you off to log in and comes back having forgotten what you
were doing — on a phone especially. Signing in beforehand avoids that entirely.

GitHub is needed because Cloudflare copies the code into your own account. You
will not have to use GitHub for anything afterwards.

### 3. Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Sumandev911/dmdrop)

Sign in to Cloudflare (free), and it will create everything for you — the app,
the database, the queue, the scheduled job. When it asks for secrets, paste the
two values from step 1:

| Field | Where it comes from |
|---|---|
| `SESSION_SECRET` | the first value on the keys page |
| `TOKEN_ENCRYPTION_KEY` | the second value on the keys page |

**Save both somewhere safe** before you continue — a password manager, or a
note. You will not be shown them again.

### 4. Open your instance

Cloudflare gives you an address ending in `.workers.dev`. Open it. The setup
wizard takes it from there: choose a password, then connect Instagram.

Connecting has two options and the first one takes about thirty seconds:

- **Connect with dmdrop** — one tap, no developer account needed
- **Use my own Meta app** — about fifteen minutes in Meta's console, and then
  nothing of ours is involved at all, not even for incoming messages

You can switch between them later without losing anything.

### 5. Enter your licence key

Settings → Licence → paste the key from your purchase email.

---

## What it needs

- A **Business** or **Creator** Instagram account. Switching is free, in the
  Instagram app under Settings → Account type and tools.
- A Cloudflare account. Free.
- About ten minutes.

## What it costs

Nothing after the licence. It fits inside Cloudflare's free tier for a single
creator: 100,000 requests a day, 5GB of database, 10,000 queue operations a day.

## Where your data lives

On your Cloudflare account, in your database. Your Instagram token is encrypted
with the key you generated in step 1, which we never see.

If you chose **Connect with dmdrop**, incoming comments and DMs are relayed to
you through connect.dmdrop.in — the connection service, which stores no tokens
and no message content. Details at https://connect.dmdrop.in/privacy. Using your
own Meta app avoids even that.

## Help

There is a Help section inside the app covering every setting in plain language,
including what to check when nothing is sending.

Still stuck: **baviskoo@gmail.com**

## Licence

See `LICENSE.md`. One purchase, one instance, yours to run for as long as you
like. Refunds: https://connect.dmdrop.in/refunds
