// netlify/functions/publish.js

const { getStore } = require('@netlify/blobs');

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
        body: JSON.stringify({
          ok: false,
          error: 'Missing SHOPIFY_STORE or SHOPIFY_ADMIN_ACCESS_TOKEN'
        })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const items = Array.isArray(body.items) ? body.items : [];
    const week  = body.week || null;

    if (!items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'No items to publish' })
      };
    }

    // Helper: REST call to Shopify
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

    // 1) Build a map: productId -> { regular, promo }
    // We derive productId from each line's variant via REST.
    const productConfig = new Map(); // productId -> { regular, promo }
    const variantToProduct = new Map(); // variantId -> productId

    for (const it of items) {
      const variantId = it.variant_id;
      const regular   = Number(it.price ?? 0);
      const promo     = Number(it.promo_price ?? 0);

      if (!variantId || !promo || promo <= 0) continue;

      // If we already know this variant's product, re-use it
      let productId = variantToProduct.get(variantId);

      if (!productId) {
        const vResp = await shopifyFetch(`/variants/${variantId}.json`, {
          method: 'GET'
        });

        if (!vResp.ok) {
          const t = await vResp.text();
          console.error('Failed to fetch variant', variantId, vResp.status, t);
          continue;
        }

        const vData = await vResp.json();
        productId = vData?.variant?.product_id;
        if (!productId) continue;

        variantToProduct.set(variantId, productId);
      }

      // Only set config if not already existing (first line wins per product)
      if (!productConfig.has(productId)) {
        productConfig.set(productId, { regular, promo });
      }
    }

    if (!productConfig.size) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          error: 'No valid promo items found (missing variant_id or promo_price)'
        })
      };
    }

    // 2) For each product, fetch all variants, snapshot original prices, then update all variants
    let updated = 0;
    const errors = [];
    const snapshotVariants = []; // for rollback

    for (const [productId, cfg] of productConfig.entries()) {
      try {
        const pResp = await shopifyFetch(`/products/${productId}.json`, {
          method: 'GET'
        });

        if (!pResp.ok) {
          const t = await pResp.text();
          console.error('Failed to fetch product', productId, pResp.status, t);
          errors.push({ product_id: productId, error: `Product fetch error ${pResp.status}` });
          continue;
        }

        const pData = await pResp.json();
        const prod  = pData?.product;
        if (!prod || !Array.isArray(prod.variants)) continue;

        const { regular, promo } = cfg;

        // If no regular given, we use each variant's own original as compare_at_price
        for (const v of prod.variants) {
          const variantId = v.id;
          const originalPrice = v.price;
          const originalCompareAt = v.compare_at_price;

          // Save snapshot for rollback
          snapshotVariants.push({
            id: variantId,
            price: originalPrice,
            compare_at_price: originalCompareAt
          });

          // Decide new price + compare_at
          const newPrice = promo; // apply same promo to all variants of this product
          const newCompareAt = regular > 0 ? regular : originalPrice;

          const payload = {
            variant: {
              id: variantId,
              price: newPrice,
              compare_at_price: newCompareAt
            }
          };

          const upResp = await shopifyFetch(`/variants/${variantId}.json`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });

          if (!upResp.ok) {
            const t = await upResp.text();
            console.error('Failed to update variant', variantId, upResp.status, t);
            errors.push({
              variant_id: variantId,
              error: `Update error ${upResp.status}`
            });
          } else {
            updated++;
          }
        }
      } catch (err) {
        console.error('Product loop error', productId, err);
        errors.push({ product_id: productId, error: err.message || String(err) });
      }
    }

    // 3) Save snapshot for rollback in Netlify Blobs (latest campaign)
    if (snapshotVariants.length) {
      const store = getStore('promo-campaigns');
      const campaign = {
        id: new Date().toISOString(),
        week,
        created_at: new Date().toISOString(),
        variants: snapshotVariants
      };
      await store.set('latest', JSON.stringify(campaign));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: errors.length === 0,
        updated,
        errors
      })
    };
  } catch (err) {
    console.error('publish function error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: 'Server error in publish function'
      })
    };
  }
};
