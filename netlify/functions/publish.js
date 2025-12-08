// netlify/functions/publish.js

/* ------------------ B L O B S   H E L P E R ------------------ */

let getStoreSafe = null;
try {
  ({ getStore: getStoreSafe } = require('@netlify/blobs'));
} catch (e) {
  console.warn('[publish] @netlify/blobs not available', e);
}

function getCampaignStore() {
  if (!getStoreSafe) {
    console.warn('[publish] getStoreSafe is null');
    return null;
  }

  // Accept multiple env var names (to match your other Netlify projects)
  const siteID =
    process.env.NETLIFY_SITE_ID ||
    process.env.BLOBS_SITE_ID ||
    process.env.SITE_ID;

  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.BLOBS_TOKEN ||
    process.env.NETLIFY_API_TOKEN;

  if (!siteID || !token) {
    console.warn('[publish] Missing blobs env vars. Found:', {
      NETLIFY_SITE_ID: !!process.env.NETLIFY_SITE_ID,
      BLOBS_SITE_ID: !!process.env.BLOBS_SITE_ID,
      SITE_ID: !!process.env.SITE_ID,
      NETLIFY_BLOBS_TOKEN: !!process.env.NETLIFY_BLOBS_TOKEN,
      BLOBS_TOKEN: !!process.env.BLOBS_TOKEN,
      NETLIFY_API_TOKEN: !!process.env.NETLIFY_API_TOKEN
    });
    return null;
  }

  try {
    return getStoreSafe('promo-campaigns', { siteID, token });
  } catch (e) {
    console.error('[publish] getStore failed', e);
    return null;
  }
}

/* ------------------ H A N D L E R ------------------ */

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const shop  = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    if (!shop || !token) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: 'Missing Shopify env vars' })
      };
    }

    const body  = event.body ? JSON.parse(event.body) : {};
    const items = Array.isArray(body.items) ? body.items : [];
    const week  = body.week || new Date().toISOString().slice(0, 10);

    if (!items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'No items to publish' })
      };
    }

    async function shopifyFetch(path, opts = {}) {
      const url = `https://${shop}/admin/api/2024-07${path}`;
      const resp = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        },
        ...opts
      });
      return resp;
    }

    // Map of product → { regular_price, promo_price }
    const productConfig = new Map();
    const variantToProduct = new Map();
    const allVariantIds = new Set();

    // ----------------- Build productConfig -----------------
    for (const it of items) {
      const variantId = it.variant_id;
      const regular   = Number(it.price ?? 0);
      const promo     = Number(it.promo_price ?? 0);

      if (!variantId || !promo || promo <= 0) continue;

      allVariantIds.add(variantId);

      let productId = variantToProduct.get(variantId);
      if (!productId) {
        const vResp = await shopifyFetch(`/variants/${variantId}.json`);
        const vData = await vResp.json();
        productId = vData?.variant?.product_id;
        if (!productId) continue;
        variantToProduct.set(variantId, productId);
      }

      if (!productConfig.has(productId)) {
        productConfig.set(productId, { regular, promo });
      }
    }

    if (!productConfig.size) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, error: 'No valid promo items' })
      };
    }

    // ----------------- Update Shopify -----------------
    let updated = 0;
    const errors = [];

    for (const [productId, cfg] of productConfig.entries()) {
      try {
        const pResp = await shopifyFetch(`/products/${productId}.json`);
        const pData = await pResp.json();
        const prod  = pData?.product;
        if (!prod) continue;

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
            method: 'PUT',
            body: JSON.stringify(payload)
          });

          if (!upResp.ok) {
            errors.push({ variantId, error: `Update failed ${upResp.status}` });
          } else {
            updated++;
          }
        }
      } catch (err) {
        errors.push({ productId, error: err.message });
      }
    }

    // ----------------- Save Campaign in Blobs -----------------
    let campaignRecorded = false;
    const store = getCampaignStore();

    if (store && productConfig.size) {
      try {
        const id = new Date().toISOString();
        const product_ids = [...productConfig.keys()];
        const variant_ids = [...allVariantIds];

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

        // Save index
        let index = [];
        const raw = await store.get('index');
        if (raw) index = JSON.parse(raw) || [];

        index.unshift({
          id,
          week,
          created_at: id,
          product_count: product_ids.length
        });

        index = index.slice(0, 50);
        await store.set('index', JSON.stringify(index));

        campaignRecorded = true;
        console.log('[publish] Campaign recorded', id);
      } catch (err) {
        console.error('[publish] Failed to record campaign', err);
      }
    } else {
      console.log('[publish] No Blobs store available → campaign not recorded');
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
    console.error('[publish] Fatal error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Server error' })
    };
  }
};
