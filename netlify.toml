// netlify/functions/results.js
// Netlify Functions require: exports.handler = async (event) => ({...})

const { getStore } = require("@netlify/blobs");
const { fetchOrdersSince, kpisForWeek, learnHeroes } = require("./_analytics.js");
const { gql } = require("./_shopify.js");

function getManualStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN; // Netlify PAT

  // Don’t leak values; just indicate presence
  console.log("[results] Env check:", {
    NETLIFY_SITE_ID: siteID ? "present" : "missing",
    NETLIFY_BLOBS_TOKEN: token ? "present" : "missing",
  });

  if (!siteID || !token) return null;

  // ✅ Manual mode store
  return getStore(name, { siteID, token });
}

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
    // Use same store as drafts/campaigns OR keep separate.
    // If your drafts are stored elsewhere, change store name accordingly.
    // Here we reuse a single store and your original key:
    const store = getManualStore("promo-campaigns");
    if (!store) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeks: [], ok: true, blobsEnabled: false }),
      };
    }

    const week = new Date().toISOString().slice(0, 10);

    // Your original key:
    // promo_weeks/{week}.json
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
        status: draft.status || "draft",
      });
    }

    // Hero learning (only if published)
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
      body: JSON.stringify({ weeks, ok: true, blobsEnabled: true }),
    };
  } catch (err) {
    console.error("[results] fatal error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: err?.message || "Server error", weeks: [] }),
    };
  }
};
