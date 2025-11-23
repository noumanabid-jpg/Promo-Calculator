// netlify/functions/_analytics.js
// Fetches orders and line-items for velocity / uplift / sell-through calculations.
// IMPORTANT: No customer fields → does NOT require read_customers scope.

import { gql } from './_shopify.js';

/**
 * Fetch orders since N days ago.
 * Returns line items only — no customer data (avoids read_customers scope).
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
          lineItems(first: 50) {
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
