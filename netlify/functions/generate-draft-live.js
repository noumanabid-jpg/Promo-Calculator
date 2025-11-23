// netlify/functions/generate-draft-live.js
// Live version: product-level logic, nationwide availability,
// category-based discounts, no Blobs.

import { gql, money } from './_shopify.js';
import { normalize, scoreVariant } from './_engine.js';

// Config
const DO_NOT = (process.env.DO_NOT_DISCOUNT_TAG || 'do_not_discount').toLowerCase();
const TOP_FRUIT = Number(process.env.SUGGESTION_TOPN_FRUIT || 6);
const TOP_VEG   = Number(process.env.SUGGESTION_TOPN_VEG   || 6);

// Cities we require for nationwide promo
const REQUIRED_CITIES = ['jeddah', 'riyadh', 'dammam'];

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
    let skippedNoNationwide = 0;

    for (const p of data.products.nodes) {
      const pt = (p.productType || '').toLowerCase();
      const tags = (p.tags || []).map((t) => String(t).toLowerCase());
      const skip = tags.includes(DO_NOT);
      if (skip) {
        skippedTag++;
        continue;
      }

      // basic category mapping
      let category = 'other';
      if (pt.includes('fruit')) category = 'fruit';
      else if (pt.includes('veg')) category = 'vegetable';
      else if (tags.some((t) => t.includes('fruit'))) category = 'fruit';
      else if (tags.some((t) => t.includes('veg'))) category = 'vegetable';

      // group variants by city name
      const byCity = {};
      for (const v of p.variants.nodes) {
        const cityKey = (v.title || '').toLowerCase().trim(); // "jeddah", "riyadh", "dammam"
        byCity[cityKey] = v;
      }

      // Only consider products that have ALL required cities
      const hasAllCities = REQUIRED_CITIES.every((city) => byCity[city]);
      if (!hasAllCities) {
        skippedNoNationwide++;
        continue;
      }

      const jVar = byCity['jeddah'];
      if (!jVar) {
        skippedNoNationwide++;
        continue;
      }

      const price = money(jVar.price);
      if (!price || price <= 0) {
        skippedNoPrice++;
        continue;
      }

      let cost = money(jVar.inventoryItem?.unitCost?.amount);
      const compare_at = money(jVar.compareAtPrice);

      const flags = [];

      // Fallback if cost missing -> 70% of price
      if (!cost || cost <= 0) {
        cost = Math.max(0.01, price * 0.7);
        flags.push('cost:fallback');
      }

      // Nationwide inventory: sum across required cities
      const inventoryTotal = REQUIRED_CITIES.reduce((acc, city) => {
        const v = byCity[city];
        return acc + Number(v?.inventoryQuantity || 0);
      }, 0);

      all.push({
        product_id: p.id,
        title: p.title,
        category,
        tags,
        variant_id: jVar.id,      // Jeddah variant used for display
        variant: jVar.title,
        sku: jVar.sku,
        price,
        compare_at,
        inventory: inventoryTotal,
        cost,
        hero: tags.includes('hero'),
        velocity: 0,              // can be filled from orders later
        flags
      });
    }

    if (!all.length) {
      return json(200, {
        week,
        items: [],
        debug: {
          reason: 'no-variants',
          skippedNoPrice,
          skippedTag,
          skippedNoNationwide
        }
      });
    }

    // 2) Basic normalization & scoring
    const invVals = all.map((x) => x.inventory);
    const imin = Math.min(...invVals, 0);
    const imax = Math.max(...invVals, 1);

    const enriched = all.map((x) => {
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

    // 3) Pick top 6 fruit + top 6 veg (product-level)
    const fruits = enriched
      .filter((x) => x.category === 'fruit')
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_FRUIT);

    const vegs = enriched
      .filter((x) => x.category === 'vegetable')
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

    // 4) Compute attractive promo prices with category-based target discounts
    const out = [];
    let skippedGuardrail = 0;

    for (const it of picks) {
      const promo = computePromoPrice(it.price, it.cost, it.category);
      if (!promo) {
        skippedGuardrail++;
        continue;
      }

      const promo_price = promo;
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
        mode: 'live-product-level',
        totalAll: all.length,
        fruitsPicked: fruits.length,
        vegsPicked: vegs.length,
        skippedNoPrice,
        skippedTag,
        skippedNoNationwide,
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

/**
 * Category-based promo price:
 * - Fruit: target ~30% off
 * - Veg:   target ~20% off
 * - Other: 20%
 * - Enforce margin >= 3%
 * - Round to .50 / .95
 */
function computePromoPrice(price, cost, category) {
  const p = money(price);
  const c = money(cost);
  if (!p || p <= 0) return null;
  if (!c || c <= 0) return null;
  if (c >= p) return null;

  let targetDiscount;
  if (category === 'fruit') targetDiscount = 0.30;
  else if (category === 'vegetable') targetDiscount = 0.20;
  else targetDiscount = 0.20;

  let candidate = p * (1 - targetDiscount);
  if (candidate <= 0) return null;

  candidate = roundPsych(candidate);
  if (candidate <= 0) return null;

  // enforce margin >= 3%
  let margin = (candidate - c) / candidate;
  if (margin < 0.03) {
    const minPrice = c / (1 - 0.03);
    candidate = roundPsych(minPrice);
    if (candidate <= 0) return null;
    margin = (candidate - c) / candidate;
    if (margin < 0.03) return null;
  }

  return candidate;
}

/**
 * Round to *.50 or *.95
 */
function roundPsych(value) {
  const v = money(value);
  if (v <= 0) return 0;
  const whole = Math.floor(v);
  const decimals = v - whole;

  let candidate;
  if (decimals <= 0.5) {
    candidate = whole + 0.5;
  } else {
    candidate = whole + 0.95;
  }

  // If still below the original value (rare due to rounding), nudge up
  if (candidate < v) {
    // bump by 0.5 as a simple step
    candidate = whole + 1.5;
  }

  return Number(candidate.toFixed(2));
}
