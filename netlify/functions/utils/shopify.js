// netlify/functions/utils/shopify.js

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function shopifyGraphql({ shop, token, query, variables }) {
  const url = `https://${shop}/admin/api/2024-07/graphql.json`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await r.json();

  if (json.errors) {
    console.error("GraphQL errors:", json.errors);
    throw new Error("Shopify GraphQL error");
  }

  return json;
}

module.exports = { shopifyGraphql };
