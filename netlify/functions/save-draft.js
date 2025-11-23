// netlify/functions/save-draft.js

import { getStore } from '@netlify/blobs';

export default async function handler(request, context) {
  try {
    if (request.method !== 'POST') {
      return json(405, { error: 'Only POST allowed' });
    }

    const body = await request.json().catch(() => null);
    const week = body?.week;
    const items = body?.items;

    if (!week || !Array.isArray(items)) {
      return json(400, { error: 'Missing week or items[] in body' });
    }

    const store = getStore('promo-planner');

    await store.setJSON(`promo_weeks/${week}.json`, {
      week,
      items,
      status: 'draft',
      updatedAt: new Date().toISOString()
    });

    return json(200, { ok: true });
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
