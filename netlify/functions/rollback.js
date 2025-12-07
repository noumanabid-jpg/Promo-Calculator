// netlify/functions/rollback.js

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

    const store = getStore('promo-campaigns');
    const raw   = await store.get('latest');

    if (!raw) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          error: 'No campaign snapshot found to rollback'
        })
      };
    }

    let campaign;
    try {
      campaign = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse campaign snapshot', e);
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: 'Invalid campaign snapshot'
        })
      };
    }

    const variants = Array.isArray(campaign.variants) ? campaign.variants : [];
    if (!variants.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          error: 'No variants in campaign snapshot'
        })
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

    let restored = 0;
    const errors = [];

    for (const v of variants) {
      const variantId = v.id;
      if (!variantId) continue;

      const payload = {
        variant: {
          id: variantId,
          price: v.price,
        }
      };

      // Only send compare_at_price if it existed in snapshot (can be null/empty)
      if (v.hasOwnProperty('compare_at_price')) {
        payload.variant.compare_at_price = v.compare_at_price;
      }

      try {
        const resp = await shopifyFetch(`/variants/${variantId}.json`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });

        if (!resp.ok) {
          const t = await resp.text();
          console.error('Rollback update error', variantId, resp.status, t);
          errors.push({
            variant_id: variantId,
            error: `Rollback update error ${resp.status}`
          });
        } else {
          restored++;
        }
      } catch (err) {
        console.error('Rollback error for variant', variantId, err);
        errors.push({ variant_id: variantId, error: err.message || String(err) });
      }
    }

    // Optional: clear snapshot after successful rollback
    if (restored > 0) {
      await store.delete('latest').catch(() => {});
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: errors.length === 0,
        restored,
        errors,
        campaign_id: campaign.id,
        week: campaign.week
      })
    };
  } catch (err) {
    console.error('rollback function error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: 'Server error in rollback function'
      })
    };
  }
};
