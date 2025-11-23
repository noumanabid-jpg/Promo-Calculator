// netlify/functions/_analytics.js
// Order analytics helpers for velocity & weekly KPIs.
// IMPORTANT: No customer fields → does NOT require read_customers scope.

import { gql } from './_shopify.js';

/**
 * Fetch orders since N days ago.
 * Returns line items and totals only — no customer data.
 */
export async function fetchOrdersSince(days = 56) {
  const date = new Date(Date.now() - days * 24 * 3600 * 1000)
    .toISOString()
    .split('T')[0];

  const Q = `#graphql
    query OrdersSince($query: String!) {
      orders(first: 250, query: $query) {
        nodes {
          id
          createdAt
          totalPriceSet {
            shopMoney {
              amount
            }
          }
          lineItems(first: 100) {
            nodes {
              quantity
              variant {
                id
              }
            }
          }
        }
      }
    }
  `;

  const data = await gql(Q, { query: `created_at:>=${date}` });
  return data.orders?.nodes || [];
}

/**
 * Compute simple KPIs for a given promo week (YYYY-MM-DD).
 * Minimal, safe version (placeholders for gm/markdown/retention).
 */
export async function kpisForWeek(week) {
  const start = new Date(week);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid week key: ${week}`);
  }
  const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);

  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const allOrders = await fetchOrdersSince(90);

  const orders = allOrders.filter((o) => {
    const t = new Date(o.createdAt).toISOString();
    return t >= startISO && t < endISO;
  });

  let units = 0;
  let revenue = 0;
  let ordersCount = 0;

  for (const o of orders) {
    const lineItems = o.lineItems?.nodes || [];
    let orderUnits = 0;

    for (const li of lineItems) {
      const q = li.quantity || 0;
      units += q;
      orderUnits += q;
    }

    if (orderUnits > 0) {
      ordersCount += 1;
    }

    const total = Number(o.totalPriceSet?.shopMoney?.amount || 0);
    revenue += total;
  }

  return {
    units,
    revenue,
    gm: 0,          // placeholder gross margin %
    markdown: 0,    // placeholder markdown cost
    orders: ordersCount,
    retention14: 0  // placeholder retention metric
  };
}

/**
 * Hero learning stub — no-op to avoid extra scopes.
 */
export async function learnHeroes(week, promoItems = []) {
  return { week, updated: 0, considered: promoItems.length };
}
