// netlify/functions/current-draft.js

import { getStore } from '@netlify/blobs';

export default async function handler(request, context) {
  try {
    const url = new URL(request.url);
    const weekParam = url.searchParams.get('week');
    const week = weekParam || new Date().toISOString().slice(0, 10);

    const store = getStore('promo-planner');

    const data = await store.get(`promo_weeks/${week}.json`, { type: 'json' });

    if (!data) {
      return json(200, { week, items: [], status: 'empty' });
    }

    return json(200, data);
  } catch (e) {
    return json(500, { error: String(e) });
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
