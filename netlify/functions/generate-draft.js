// netlify/functions/generate-draft.js

import { getStore } from '@netlify/blobs';
import { gql, money } from './_shopify.js';
import { applyGuardrails, normalize, scoreVariant } from './_engine.js';
import { recentAppearances } from './_fatigue.js';
import { fetchOrdersSince } from './_analytics.js';

// Config (env overrides)
const DO_NOT = (process.env.DO_NOT_DISCOUNT_TAG || 'do_not_discount').toLowerCase();
const TOP_FRUIT = Number(process.env.SUGGESTION_TOPN_FRUIT || 6);
const TOP_VEG   = Number(process.env.SUGGESTION_TOPN_VEG   || 6);

/**
 * Netlify function (ESM, new runtime): must return a Response
 */
export default async function handler(request, context) {
  try {
    const week = new Date().toISOString().slice(0, 10);

    // 1) Pull products/variants with native Cost per item
    const Q = `#graphql
      query VariantsForPromo($first: Int!) {
        products(first: $first) {
          nodes {
            id
            title
            productType
            tags
            variants(first: 50) {
              nodes {
                id
                title
                sku
                price: price
                compareAtPrice
                inventoryQuantity
                inventoryItem {
                  unitCost {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }`;

    const data = await gql(Q, { first: 200 });

    // 2) Velocity proxy from orders (last 56 days ~ 8 weeks)
    const orders = await fetchOrdersSince(56);
    const orderUnitsByVariant = {};
    for (const o of orders) {
      for (const li of o.lineItems.nodes) {
        const id = li.variant?.id;
        if (!id) continue;
        orderUnitsByVariant[id] = (orderUnitsByVariant[id] || 0) + (li.quantity || 0);
      }
    }

    const all = [];
    let skippedNoPriceOrCost = 0;
    let skippedDoNot = 0;

    // 3) Gather candidate variants
    for (const p of data.products.nodes) {
      const category = (p.productType || 'other').toLowerCase();
      const tagset = (p.tags || []).map((t) => String(t).toLowerCase());
      const skipTag = tagset.includes(DO_NOT);

      for (const v of p.variants.nodes) {
        let price = money(v.price);
        let cost = money(v.inventoryItem?.unitCost?.amount);
        const compare_at = money(v.compareAtPrice);
        const inventory = Number(v.inventoryQuantity || 0);
        const velocity = orderUnitsByVariant[v.id] || 0;
        const flags = [];

        if (skipTag) {
          skippedDoNot++;
          continue;
        }

        if (!price || price <= 0) {
          skippedNoPriceOrCost++;
          continue;
        }

        // If cost is missing in Shopify, fallback to 70% of price, but mark it
        if (!cost || cost <= 0) {
          cost = Math.max(0.01, price * 0.7);
          flags.push('cost:fallback');
        }

        all.push({
          product_id: p.id,
          title: p.title,
          category,
          tags: tagset,
          variant_id: v.id,
          variant: v.title,
          sku: v.sku,
          price,
          compare_at,
          inventory,
          cost,
          skip: false,
          hero: tagset.includes('hero'),
          velocity,
          flags
        });
      }
    }

    if (!all.length) {
      return json(200, {
        week,
        items: [],
        debug: {
          reason: 'no-variants-after-basic-gather',
          skippedNoPriceOrCost,
          skippedDoNot
        }
      });
    }

    // 4) Normalize signals + fatigue control
    const velVals = all.map((x) => x.velocity);
    const vmin = Math.min(...velVals, 0);
    const vmax = Math.max(...velVals, 1);

    const invVals = all.map((x) => x.inventory);
    const imin = Math.min(...invVals, 0);
    const imax = Math.max(...invVals, 1);

    const enriched = [];
    let skippedFatigue = 0;
    let skippedImpossibleMargin = 0;

    for (const x of all) {
      // fatigue: avoid >2 recent weeks
      const appearances = await recentAppearances(x.variant_id, 8);
      const consecutive = appearances.length; // approximation (weekly files)
      if (consecutive > 2) {
        skippedFatigue++;
        continue;
      }

      const marginHeadroom = x.price > 0 ? (x.price - x.cost) / x.price : 0;
      const stockPressure = x.inventory; // normalized below

      const obj = {
        ...x,
        marginHeadroomNorm: normalize(marginHeadroom, 0, 0.5),
        stockPressureNorm: normalize(stockPressure, imin, imax),
        velocityNorm: normalize(x.velocity, vmin, vmax),
        heroBoost: x.hero ? 1 : 0
      };
      obj.score = scoreVariant(obj);
      enriched.push(obj);
    }

    if (!enriched.length) {
      return json(200, {
        week,
        items: [],
        debug: {
          reason: 'no-enriched-candidates',
          totalAll: all.length,
          skippedNoPriceOrCost,
          skippedDoNot,
          skippedFatigue
        }
      });
    }

    // 5) Pick top 6 fruit + top 6 veg
    const fruits = enriched
      .filter((x) => x.category.includes('fruit'))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_FRUIT);

    const vegs = enriched
      .filter((x) => x.category.includes('vegetable'))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_VEG);

    const picks = [...fruits, ...vegs];

    if (!picks.length) {
      return json(200, {
        week,
        items: [],
        debug: {
          reason: 'no-picks-by-category',
          totalEnriched: enriched.length,
          fruitsCount: fruits.length,
          vegsCount: vegs.length
        }
      });
    }

    // 6) Apply guardrails & rounding to compute promo prices
    const out = [];
    for (const it of picks) {
      const floor = applyGuardrails({ price: it.price, cost: it.cost }); // ≥3% margin, .50/.95 rounding
      if (!floor.ok || !floor.promo) {
        skippedImpossibleMargin++;
        continue;
      }
      const promo_price = floor.promo;
      const margin_promo = (promo_price - it.cost) / promo_price;

      out.push({
        ...it,
        promo_price,
        margin_promo,
        round_rule: '.50/.95',
        flags: [...(it.flags || [])]
      });
    }

    // 7) Persist draft in Netlify Blobs
    const store = getStore();
    await store.setJSON(`promo_weeks/${week}.json`, {
      week,
      items: out,
      status: 'draft'
    });

    return json(200, {
      week,
      items: out,
      debug: {
        totalAll: all.length,
        totalEnriched: enriched.length,
        fruitsTried: fruits.length,
        vegsTried: vegs.length,
        skippedNoPriceOrCost,
        skippedDoNot,
        skippedFatigue,
        skippedImpossibleMargin
      }
    });
  } catch (e) {
    return json(500, { error: String(e) });
  }
}

/** Helper: build a Fetch API Response with JSON */
function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
