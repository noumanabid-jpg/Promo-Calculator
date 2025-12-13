// netlify/functions/publish.js

const { getCampaignStore } = require("./utils/blobsStore");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const shop = process.env.SHOPIFY_STORE;
    const shopifyToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    if (!shop || !shopifyToken) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: "Missing SHOPIFY_STORE or SHOPIFY_ADMIN_ACCESS_TOKEN",
        }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const items = Array.isArray(body.items) ? body.items : [];
    const week = body.week || new Date().toISOString().slice(0, 10);

    if (!items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "No items to publish" }),
      };
    }

    async function shopifyFetch(path, opts = {}) {
      const url = `https://${shop}/admin/api/2024-07${path}`;
      const resp = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": shopifyToken,
          "Content-Type": "application/json",
          ...(opts.headers || {}),
        },
        ...opts,
      });
      return resp;
    }

    // Build product-level config from the planner items:
    // productId -> { regular, promo }
    const productConfig = new Map();
    const variantToProduct = new Map();
    const plannerVariantIds = new Set(); // only variants that were in the planner

    // ----------------- Build productConfig -----------------
    for (const it of items) {
      const variantId = it.variant_id;
      const regular = Number(it.price ?? 0);
      const promo = Number(it.promo_price ?? 0);

      if (!variantId || !promo || promo <= 0) continue;

      plannerVariantIds.add(Number(variantId));

      let productId = variantToProduct.get(variantId);

      if (!productId) {
        const vResp = await shopifyFetch(`/variants/${variantId}.json`, {
          method: "GET",
        });

        if (!vResp.ok) {
          const t = await vResp.text();
          console.error("[publish] Variant lookup failed:", variantId, vResp.status, t);
          continue;
        }

        const vData = await vResp.json();
        productId = vData?.variant?.product_id;

        if (!productId) continue;
        variantToProduct.set(variantId, productId);
      }

      // First item sets the product-level promo/regular
      if (!productConfig.has(productId)) {
        productConfig.set(productId, { regular, promo });
      }
    }

    if (!productConfig.size) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, error: "No valid promo items found" }),
      };
    }

    // ----------------- Update Shopify (ALL variants per product) -----------------
    let updated = 0;
    const errors = [];

    for (const [productId, cfg] of productConfig.entries()) {
      try {
        const pResp = await shopifyFetch(`/products/${productId}.json`, {
          method: "GET",
        });

        if (!pResp.ok) {
          const t = await pResp.text();
          console.error("[publish] Product fetch failed:", productId, pResp.status, t);
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
              compare_at_price: cfg.regular,
            },
          };

          const upResp = await shopifyFetch(`/variants/${variantId}.json`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });

          if (!upResp.ok) {
            const t = await upResp.text();
            console.error("[publish] Variant update failed:", variantId, upResp.status, t);
            errors.push({ variantId, error: `Update failed ${upResp.status}` });
          } else {
            updated++;
          }
        }
      } catch (err) {
        console.error("[publish] Error updating product:", productId, err);
        errors.push({ productId, error: err?.message || String(err) });
      }
    }

    // ----------------- Save Campaign in Blobs (manual mode) -----------------
    let campaignRecorded = false;

    try {
      const store = getCampaignStore();

      if (!store) {
        console.warn("[publish] Campaign store not available → campaign not recorded");
      } else {
        const id = new Date().toISOString();
        const product_ids = [...productConfig.keys()].map((n) => Number(n));
        const variant_ids = [...plannerVariantIds].map((n) => Number(n));

        const campaign = {
          id,
          week,
          created_at: id,
          product_ids,
          variant_ids,
          product_count: product_ids.length,
          item_count: items.length,
        };

        // Save detailed campaign record
        await store.set(`campaign:${id}`, JSON.stringify(campaign));

        // Update index
        let index = [];
        const raw = await store.get("index");
        if (raw) {
          try {
            index = JSON.parse(raw) || [];
          } catch {
            index = [];
          }
        }

        index.unshift({
          id,
          week,
          created_at: id,
          product_count: product_ids.length,
        });

        index = index.slice(0, 50);
        await store.set("index", JSON.stringify(index));

        campaignRecorded = true;
        console.log("[publish] Campaign recorded:", id);
      }
    } catch (err) {
      // Non-fatal — publish still succeeds
      console.error("[publish] Failed to record campaign (non-fatal):", err?.message || err);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: errors.length === 0,
        updated,
        errors,
        week,
        campaignRecorded,
      }),
    };
  } catch (err) {
    console.error("[publish] Fatal error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "Server error" }),
    };
  }
};
