// netlify/functions/rollback-campaign.js

/* ------------------ B L O B S   H E L P E R ------------------ */

let getStoreSafe = null;
try {
  ({ getStore: getStoreSafe } = require('@netlify/blobs'));
} catch (e) {
  console.warn('[rollback] @netlify/blobs not available', e);
}

function getCampaignStore() {
  if (!getStoreSafe) return null;

  const siteID =
    process.env.NETLIFY_SITE_ID ||
    process.env.BLOBS_SITE_ID ||
    process.env.SITE_ID;

  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.BLOBS_TOKEN ||
    process.env.NETLIFY_API_TOKEN;

  if (!siteID || !token) {
    console.warn('[rollback] Missing env vars for Blobs');
    return null;
  }

  try {
    return getStoreSafe('promo-campaigns', { siteID, token });
  } catch (e) {
    console.error('[rollback] getStore failed', e);
    return null;
  }
}

/* ------------------ H A N D L E R ------------------ */

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    const shop  = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    if (!shop || !token) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: 'Missing Shopify env vars' })
      };
    }

    const id = event.queryStringParameters?.id;
    if (!id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'Missing id' })
      };
    }

    const store = getCampaignStore();
    if (!store) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: 'Blobs store unavailable' })
      };
    }

    const raw = await store.get(`campaign:${id}`);
    if (!raw) {
      return {
        statusCode: 404,
        body: JSON.stringify({ ok: false, error: 'Campaign not found' })
      };
    }

    let campaign;
    try {
      campaign = JSON.parse(raw);
    } catch {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: 'Invalid campaign data' })
      };
    }

    const variantIds = campaign.variant_ids || [];

    async function shopifyFetch(path, opts = {}) {
      const url = `https://${shop}/admin/api/2024-07${path}`;
      return await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json'
        },
        ...opts
      });
    }

    let restored = 0;
    const errors = [];

    for (const variantId of variantIds) {
      try {
        const vResp = await shopifyFetch(`/variants/${variantId}.json`);
        const vData = await vResp.json();

        const compareAt = vData?.variant?.compare_at_price;
        if (!compareAt) continue;

        const payload = {
          variant: {
            id: variantId,
            price: compareAt,
            compare_at_price: null
          }
        };

        const upResp = await shopifyFetch(`/variants/${variantId}.json`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });

        if (!upResp.ok) {
          errors.push({ variantId, error: `Update failed ${upResp.status}` });
        } else {
          restored++;
        }
      } catch (err) {
        errors.push({ variantId, error: err.message });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: errors.length === 0,
        restored,
        errors
      })
    };
  } catch (err) {
    console.error('[rollback] Fatal error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Server error' })
    };
  }
};
