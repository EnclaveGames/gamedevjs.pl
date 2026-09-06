import type { APIRoute } from 'astro';
import { generateRSS, getEvents } from '../lib/data';

export const GET: APIRoute = () =>
  new Response(generateRSS(getEvents()), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
