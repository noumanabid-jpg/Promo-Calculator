// netlify/functions/results.js

const { getCampaignStore } = require("./utils/blobsStore");

// Helper: build a store for promo weeks/results
function getPromoWeeksStore() {
  const store = getCampaignStore(); // uses "promo-campaigns" store name by default
  // If you want separate store for weeks/results, use getStore directly.
  // But simplest is reusing the same manual creds with a different store name:
  // We'll create a second store using the same manual creds.

  // If campaign store is not available, results won't work either.
  return store;
}

// Helper: read JSON from blobs (string -> object)
async function getJSON(store, key) {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

exports.handler = async () => {
  try {
    // Dynamically import your ESM helpers (since this file is CommonJS)
    const { fetchOrdersSince, kpisForWeek, learnHeroes } = await import("./_analytics.js");
    const { gql } = await import("./_shopify.js");

    const store = getPromoWeeksStore();

    if (!store) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeks: [], blobsEnabled: false })
      };
    }

    const week = new Date().toISOString().slice(0, 10);

    // Your old key was promo_weeks/{week}.json
    // We'll keep the same key, but store expects strings.
    const draft = await getJSON(store, `promo_weeks/${week}.json`);

    // Compute KPIs from orders (last 8 weeks proxy)
    const orders = await fetchOrdersSince(56);
    let weeks = [];

    if (draft?.items?.length) {
      const k = kpisForWeek(draft.items, orders);
      weeks.push({
        week,
        items: draft.items.length,
        ...k,
        status: draft.status || "draft"
      });
    }

    // Hero learning: mark top quartile performers (if published and results known)
    if (draft?.status === "published") {
      const perf = [];
      const byVariant = {};

      for (const o of orders) {
        for (const li of o.lineItems.nodes) {
          const vid = li.variant?.id;
          if (!vid) continue;
          byVariant[vid] = (byVariant[vid] || 0) + (li.quantity || 0);
        }
      }

      for (const it of draft.items) {
        perf.push({ product_id: it.product_id, units: byVariant[it.variant_id] || 0 });
      }

      const heroes = learnHeroes(perf);

      if (heroes.size > 0) {
        const MU = `#graphql
          mutation SetHero($ownerId:ID!){
            metafieldsSet(metafields:[{ownerId:$ownerId, namespace:"custom", key:"hero", value:"true", type:"boolean"}]){
              userErrors{ field message }
            }
          }`;

        for (const pid of heroes) {
          await gql(MU, { ownerId: pid });
        }
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeks, blobsEnabled: true })
    };
  } catch (err) {
    console.error("[results] error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeks: [], error: err?.message || "Server error" })
    };
  }
};
