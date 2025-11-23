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
    const week = await store.getJSON(`promo_weeks/${dt}.json`);
    if (week?.items?.some((it) => it.variant_id === variantId)) {
      out.push(dt);
    }
  }

  return out;
}
