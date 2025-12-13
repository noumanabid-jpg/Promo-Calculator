// netlify/functions/publish.js

/* ------------------ B L O B S   H E L P E R ------------------ */

let getStoreSafe = null;
try {
  ({ getStore: getStoreSafe } = require("@netlify/blobs"));
} catch (e) {
  console.warn("[publish] @netlify/blobs not available", e?.message || e);
}

function getCampaignStore() {
  if (!getStoreSafe) {
    console.warn("[publish] getStoreSafe is null (blobs module not loadable)");
    return null;
  }

  const siteID =
    process.env.NETLIFY_SITE_ID ||
    process.env.BLOBS_SITE_ID ||
    process.env.SITE_ID;

  // ✅ IMPORTANT: match YOUR env var name
  const blobsToken =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.BLOBS_TOKEN ||
    process.env.NETLIFY_API_TOKEN ||
    process.env.NETLIFY_AUTH_TOKEN;

  if (!siteID || !blobsToken) {
    console.warn("[publish] Missing blobs env vars. Found:", {
      NETLIFY_SITE_ID: !!process.env.NETLIFY_SITE_ID,
      BLOBS_SITE_ID: !!process.env.BLOBS_SITE_ID,
      SITE_ID: !!process.env.SITE_ID,
      NETLIFY_BLOBS_TOKEN: !!process.env.NETLIFY_BLOBS_TOKEN,
      BLOBS_TOKEN: !!process.env.BLOBS_TOKEN,
      NETLIFY_API_TOKEN: !!process.env.NETLIFY_API_TOKEN,
      NETLIFY_AUTH_TOKEN: !!process.env.NETLIFY_AUTH_TOKEN
    });
    return null;
  }

  try {
    return getStoreSafe("promo-campaigns", { siteID, token: blobsToken });
  } catch (e) {
    console.error("[publish] getStore failed", e?.message || e);
    return null;
  }
}

/* ------------------ H A N D L E R ------------------ */

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const shop = process.env.SHOPIFY_STORE;
    const shopifyToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN; // ✅ avoid name collision

    if (!shop || !shopifyToken) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: "Missing Shopify env vars" })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const items = Array.isArray(body.items) ? body.items : [];
    const week = body.week || new Date().toISOString().slice(0, 10);

    if (!items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "No items to publish" })
      };
    }

    async function shopifyFetch(path, opts = {}) {
      const url = `https://${shop}/admin/api/2024-07${path}`;
      const resp = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": shopifyToken,
          "Content-Type": "application/json",
          ...(opts.headers || {})
        },
        ...opts
      });
      return resp;
    }

    // Map of product → { regular_price, promo_price }
    const productConfig = new Map();      // productId -> { regular, promo }
    const variantToProduct = new Map();   // variantId -> productId
    const allVariantIds = new Set();      // variants included in planner items (not all product variants)

    // ----------------- Build productConfig -----------------
    for (const it of items) {
      const variantId = it.variant_id;
      const regular = Number(it.price ?? 0);
      const promo = Number(it.promo_price ?? 0);

      if (!variantId || !promo || promo <= 0) continue;

      allVariantIds.add(Number(variantId));

      let productId = variantToProduct.get(variantId);

      if (!productId) {
        const vResp = await shopifyFetch(`/variants/${variantId}.json`, { method: "GET" });

        if (!vResp.ok) {
          const t = await vResp.text();
          console.error("[publish] Variant fetch failed", variantId, vResp.status, t);
          continue;
        }

        const vData = await vResp.json();
        productId = vData?.variant?.product_id;

        if (!productId) continue;
        variantToProduct.set(variantId, productId);
      }

      // First item for a product sets the product-level config.
      if (!productConfig.has(productId)) {
        productConfig.set(productId, { regular, promo });
      }
    }

    if (!productConfig.size) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, error: "No valid promo items" })
      };
    }

    // ----------------- Update Shopify (ALL variants for each product) -----------------
    let updated = 0;
    const errors = [];

    for (const [productId, cfg] of productConfig.entries()) {
      try {
        const pResp = await shopifyFetch(`/products/${productId}.json`, { method: "GET" });

        if (!pResp.ok) {
          const t = await pResp.text();
          console.error("[publish] Product fetch failed", productId, pResp.status, t);
          errors.push({ productId, error: `Product fetch failed ${pResp.status}` });
          continue;
        }

        const pData = await pResp.json();
        const prod = pData?.product;
        if (!prod || !Array.isArray(prod.variants)) continue;

        for (const v of prod.variants) {
          const variantId = v.id;

          const payload = {
            variant: {
              id: variantId,
              price: cfg.promo,
              compare_at_price: cfg.regular
            }
          };

          const upResp = await shopifyFetch(`/variants/${variantId}.json`, {
            method: "PUT",
            body: JSON.stringify(payload)
          });

          if (!upResp.ok) {
            const t = await upResp.text();
            console.error("[publish] Update failed", variantId, upResp.status, t);
            errors.push({ variantId, error: `Update failed ${upResp.status}` });
          } else {
            updated++;
          }
        }
      } catch (err) {
        console.error("[publish] Product loop error", productId, err);
        errors.push({ productId, error: err?.message || String(err) });
      }
    }

    // ----------------- Save Campaign in Blobs (Manual mode: siteID + NETLIFY_BLOBS_TOKEN) -----------------
    let campaignRecorded = false;

    try {
      const store = getCampaignStore();

      if (store && productConfig.size) {
        const id = new Date().toISOString();

        const product_ids = [...productConfig.keys()].map(n => Number(n));
        const variant_ids = [...allVariantIds].map(n => Number(n));

        const campaign = {
          id,
          week,
          created_at: id,
          product_ids,
          variant_ids,
          product_count: product_ids.length,
          item_count: items.length
        };

        // Save detailed campaign
        await store.set(`campaign:${id}`, JSON.stringify(campaign));

        // Update index
        let index = [];
        const raw = await store.get("index");
        if (raw) {
          try { index = JSON.parse(raw) || []; } catch {}
        }

        index.unshift({
          id,
          week,
          created_at: id,
          product_count: product_ids.length
        });

        index = index.slice(0, 50);
        await store.set("index", JSON.stringify(index));

        campaignRecorded = true;
        console.log("[publish] Campaign recorded", id);
      } else {
        console.log("[publish] No Blobs store available → campaign not recorded");
      }
    } catch (err) {
      console.error("[publish] Failed to record campaign (non-fatal)", err?.message || err);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: errors.length === 0,
        updated,
        errors,
        week,
        campaignRecorded
      })
    };
  } catch (err) {
    console.error("[publish] Fatal error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "Server error" })
    };
  }
};
