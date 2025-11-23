// netlify/functions/generate-draft-live.js
// Live version: pulls real products/variants from Shopify Admin API,
// uses native Cost per item, and returns 12 suggested items (6 fruit, 6 veg).
// No Blobs used here to keep it simple & robust.

import { gql, money } from './_shopify.js';
import { applyGuardrails, normalize, scoreVariant } from './_engine.js';

// Config
const DO_NOT = (process.env.DO_NOT_DISCOUNT_TAG || 'do_not_discount').toLowerCase();
const TOP_FRUIT = Number(process.env.SUGGESTION_TOPN_FRUIT || 6);
const TOP_VEG   = Number(process.env.SUGGESTION_TOPN_VEG   || 6);

export default async function handler(request, context) {
  try {
    const week = new Date().toISOString().slice(0, 10);

    // 1) Pull products & variants with native Cost per item
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
      }
    `;

    const data = await gql(Q, { first: 200 });

    const all = [];
    let skippedNoPrice = 0;
    let skippedTag = 0;

    for (const p of data.products.nodes) {
      const pt = (p.productType || '').toLowerCase();
      const tags = (p.tags || []).map(t => String(t).toLowerCase());
      const skip = tags.includes(DO_NOT);

      // very simple category mapping
      let category = 'other';
      if (pt.includes('fruit')) category = 'fruit';
      else if (pt.includes('veg')) category = 'vegetable';
      else if (tags.some(t => t.includes('fruit'))) category = 'fruit';
      else if (tags.some(t => t.includes('veg'))) category = 'vegetable';

      for (const v of p.variants.nodes) {
        if (skip) {
          skippedTag++;
          continue;
        }

        const price = money(v.price);
        if (!price || price <= 0) {
          skippedNoPrice++;
          continue;
        }

        let cost = money(v.inventoryItem?.unitCost?.amount);
        const compare_at = money(v.compareAtPrice);
        const inventory = Number(v.inventoryQuantity || 0);
        const flags = [];

        // fallback if cost missing → 70% of price, but mark it
        if (!cost || cost <= 0) {
          cost = Math.max(0.01, price * 0.7);
          flags.push('cost:fallback');
        }

        all.push({
          product_id: p.id,
          title: p.title,
          category,
          tags,
          variant_id: v.id,
          variant: v.title,
          sku: v.sku,
          price,
          compare_at,
          inventory,
          cost,
          hero: tags.includes('hero'),
          velocity: 0,      // can be filled from orders later
          flags
        });
      }
    }

    if (!all.length) {
      return json(200, {
        week,
        items: [],
        debug: {
          reason: 'no-variants',
          skippedNoPrice,
          skippedTag
        }
      });
    }

    // 2) Basic normalization & scoring (no orders/fatigue yet)
    const invVals = all.map(x => x.inventory);
    const imin = Math.min(...invVals, 0);
    const imax = Math.max(...invVals, 1);

    const enriched = all.map(x => {
      const marginHeadroom = x.price > 0 ? (x.price - x.cost) / x.price : 0;

      const obj = {
        ...x,
        marginHeadroomNorm: normalize(marginHeadroom, 0, 0.5),
        stockPressureNorm: normalize(x.inventory, imin, imax),
        velocityNorm: 0,
        heroBoost: x.hero ? 1 : 0
      };
      obj.score = scoreVariant(obj);
      return obj;
    });

    // 3) Pick top 6 fruit + top 6 veg
    const fruits = enriched
      .filter(x => x.category === 'fruit')
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_FRUIT);

    const vegs = enriched
      .filter(x => x.category === 'vegetable')
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_VEG);

    const picks = [...fruits, ...vegs];

    if (!picks.length) {
      return json(200, {
        week,
        items: [],
        debug: {
          reason: 'no-picks',
          totalAll: all.length,
          fruitsCount: fruits.length,
          vegsCount: vegs.length
        }
      });
    }

    // 4) Apply guardrails & compute promo prices
    const out = [];
    let skippedGuardrail = 0;

    for (const it of picks) {
      const floor = applyGuardrails({ price: it.price, cost: it.cost });
      if (!floor.ok || !floor.promo) {
        skippedGuardrail++;
        continue;
      }

      const promo_price = floor.promo;
      const margin_promo = (promo_price - it.cost) / promo_price;

      out.push({
        ...it,
        promo_price,
        margin_promo,
        round_rule: '.50/.95'
      });
    }

    return json(200, {
      week,
      items: out,
      debug: {
        mode: 'live',
        totalAll: all.length,
        fruitsPicked: fruits.length,
        vegsPicked: vegs.length,
        skippedNoPrice,
        skippedTag,
        skippedGuardrail
      }
    });
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
