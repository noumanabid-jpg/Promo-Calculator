// netlify/functions/_fatigue.js

import { getStore } from '@netlify/blobs';

/**
 * Return list of week keys (YYYY-MM-DD) where this variant appeared
 * in the last `weeksBack` promo files.
 */
export async function recentAppearances(variantId, weeksBack = 8) {
  const store = getStore('promo-planner');
  const out = [];

  for (let i = 0; i < weeksBack; i++) {
    const dt = new Date(Date.now() - i * 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    // Read JSON via get(..., { type: 'json' })
    const week = await store.get(`promo_weeks/${dt}.json`, { type: 'json' });
    if (week && Array.isArray(week.items)) {
      const found = week.items.some((it) => it.variant_id === variantId);
      if (found) out.push(dt);
    }
  }

  return out;
}
