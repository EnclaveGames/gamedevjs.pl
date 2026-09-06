/**
 * Unified Worker for gamedevjs.pl.
 *
 * Serves the Astro static build (`dist/`, see `wrangler.jsonc` `[assets]`)
 * plus the contact-form API. Static assets are served by Cloudflare before
 * this Worker runs; API paths are forced through via `run_worker_first`.
 * Any non-API request reaching here falls through to `env.ASSETS`.
 *
 * Routes: `POST /api/contact` (primary) and `POST /contact` (legacy path
 * kept for old clients). Accepts `{ email, subject, text }` JSON, validates
 * it, and fans out to email (Mailjet Send API v3.1) plus an optional Discord
 * webhook notification.
 *
 * Setup: create a Mailjet account, verify the sender address/domain, and
 * store the credentials as secrets (never commit them):
 *   wrangler secret put MAILJET_API_KEY
 *   wrangler secret put MAILJET_API_SECRET
 * Optional secret: DISCORD_WEBHOOK_URL (skipped when unset)
 */

interface Env {
  /** Static-asset binding (see wrangler.jsonc `assets`). */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Mailjet API credentials (set via `wrangler secret put`). */
  MAILJET_API_KEY?: string;
  MAILJET_API_SECRET?: string;
  DISCORD_WEBHOOK_URL?: string;
}

const CONTACT_TO = 'hello@end3r.com';
const CONTACT_FROM = 'Gamedevjs.pl <contact@js13kgames.com>';
const ALLOWED_ORIGINS = ['https://gamedevjs.pl', 'https://www.gamedevjs.pl'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SUBJECT = 200;
const MAX_TEXT = 20000;

// Best-effort per-IP rate limit (5 requests / 10 min per isolate).
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Everything that isn't the contact API is a static asset.
    if (path !== '/api/contact' && path !== '/contact') {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, request, { Allow: 'POST, OPTIONS' });
    }

    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (isRateLimited(ip)) {
      return json(
        { error: 'too many requests, please try again later' },
        429,
        request,
        { 'Retry-After': '600' },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400, request);
    }

    const { email, subject, text, company } = (body ?? {}) as Record<string, unknown>;

    // Honeypot: bots filling the hidden `company` field get a fake success.
    if (typeof company === 'string' && company.length > 0) {
      return json({ ok: true }, 200, request);
    }

    const problems: string[] = [];
    if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 254) {
      problems.push('email must be a valid email address');
    }
    if (typeof subject !== 'string' || subject.trim().length === 0) {
      problems.push('subject is required');
    } else if (subject.length > MAX_SUBJECT) {
      problems.push(`subject must be at most ${MAX_SUBJECT} characters`);
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      problems.push('text is required');
    } else if (text.length > MAX_TEXT) {
      problems.push(`text must be at most ${MAX_TEXT} characters`);
    }
    if (problems.length > 0) {
      return json({ error: problems.join('; ') }, 400, request);
    }

    const cleanSubject = (subject as string).trim();
    const cleanText = (text as string).trim();

    try {
      await sendMail(env, {
        from: CONTACT_FROM,
        to: CONTACT_TO,
        subject: `[GDJS] ${cleanSubject}`,
        text: `From: ${email}\n\n${cleanText}`,
        replyTo: email as string,
      });
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : 'failed to deliver message' },
        502,
        request,
      );
    }

    // Discord notification is best-effort.
    if (env.DISCORD_WEBHOOK_URL) {
      try {
        await sendDiscord(env.DISCORD_WEBHOOK_URL, {
          email: email as string,
          subject: cleanSubject,
          text: cleanText,
        });
      } catch {
        // The email already went out; don't fail the request over Discord.
      }
    }

    return json({ ok: true }, 200, request);
  },
};

function json(
  data: unknown,
  status: number,
  request: Request,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = allowedOrigin(request);
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo: string;
}

async function sendMail(env: Env, mail: OutgoingMail): Promise<void> {
  // Mailjet Send API v3.1 with HTTP Basic auth (API key as username,
  // API secret as password). Credentials come from Worker secrets so they
  // never appear in wrangler.jsonc or source.
  // Docs: https://dev.mailjet.com/docs/email-api/send-api-v31/send-basic-email
  const apiKey = env.MAILJET_API_KEY?.trim();
  const apiSecret = env.MAILJET_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error('email service not configured (missing Mailjet API credentials)');
  }

  const from = parseSender(mail.from);
  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
    },
    body: JSON.stringify({
      Messages: [
        {
          From: from,
          To: [{ Email: mail.to }],
          Subject: mail.subject,
          TextPart: mail.text,
          ReplyTo: { Email: mail.replyTo },
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).trim().slice(0, 500);
    throw new Error(
      `mailjet API request failed (${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  // Mailjet can return HTTP 200 with a per-message error status, so check it.
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return;
  }
  const status = (payload as { Messages?: Array<{ Status?: string; Errors?: Array<{ ErrorMessage?: string }> }> })
    ?.Messages?.[0]?.Status;
  if (status && status !== 'success') {
    const errors = (payload as { Messages?: Array<{ Errors?: Array<{ ErrorMessage?: string }> }> })
      ?.Messages?.[0]?.Errors?.map((e) => e.ErrorMessage).filter(Boolean);
    throw new Error(
      `mailjet rejected the message${errors?.length ? `: ${errors.join('; ')}` : ''}`,
    );
  }
}

async function sendDiscord(
  webhookUrl: string,
  msg: { email: string; subject: string; text: string },
): Promise<void> {
  // Discord webhooks accept a plain `content` message (2000 char limit).
  const content = `Yo, somebody is trying to contact us!\nFrom: ${msg.email}\nSubject: ${msg.subject}\n${msg.text}`.slice(0, 1900);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`discord webhook request failed (${res.status})`);
  }
}

/**
 * Accepts `"Name <email>"` or a plain `email` (CONTACT_FROM uses the
 * former) and splits it into Mailjet's `{ Email, Name }` sender shape.
 */
function parseSender(from: string): { Email: string; Name?: string } {
  const match = from.match(/^(.*)<([^<>@\s]+@[^<>@\s]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^["']|["']$/g, '').trim();
    return name ? { Email: match[2].trim(), Name: name } : { Email: match[2].trim() };
  }
  return { Email: from.trim() };
}
