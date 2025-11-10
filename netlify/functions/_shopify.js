// netlify/functions/_shopify.js

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

if (!SHOP) console.warn("SHOPIFY_STORE missing");
if (!TOKEN) console.warn("SHOPIFY_ADMIN_ACCESS_TOKEN missing");

const API_URL = `https://${SHOP}/admin/api/2024-10/graphql.json`;

/** Minimal GraphQL helper using global fetch (Node 18+) */
export async function gql(query, variables = {}) {
  if (!SHOP || !TOKEN) {
    throw new Error("Missing Shopify env vars (SHOPIFY_STORE / SHOPIFY_ADMIN_ACCESS_TOKEN)");
  }
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(data)}`);
  if (data.errors) throw new Error("Shopify GraphQL errors: " + JSON.stringify(data.errors));
  return data.data;
}

export const money = (n) => Math.max(0, Number(n || 0));
