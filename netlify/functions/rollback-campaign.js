// netlify/functions/rollback-campaign.js

let getStoreSafe = null;
let connectLambdaSafe = null;
try {
  ({ getStore: getStoreSafe, connectLambda: connectLambdaSafe } = require('@netlify/blobs'));
} catch (e) {
  console.warn('Blobs not available, rollback-campaign will not work', e);
}

exports.handler = async (event) => {
  // Initialise blobs env in Lambda-compat mode
  if (connectLambdaSafe) {
    try {
      connectLambdaSafe(event);
    } catch (e) {
      console.warn('[rollback-campaign] connectLambda failed', e);
    }
  }

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

    if (!getStoreSafe) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: 'Campaign storage not configured'
        })
      };
    }

    const id = event.queryStringParameters?.id;
    if (!id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'Missing campaign id' })
      };
    }

    const store = getStoreSafe('promo-campaigns');
    const raw   = await store.get(`campaign:${id}`);

    if (!raw) {
      return {
        statusCode: 404,
        body: JSON.stringify({ ok: false, error: 'Campaign not found' })
      };
    }

    let campaign;
    try {
      campaign = JSON.parse(raw) || {};
    } catch (e) {
      console.error('Failed to parse campaign', e);
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: 'Invalid campaign data' })
      };
    }

    const productIds = Array.isArray(campaign.product_ids) ? campaign.product_ids : [];
    const variantIdsFromCampaign = Array.isArray(campaign.variant_ids) ? campaign.variant_ids : [];

    // Helper to call Shopify REST Admin
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

    // Prefer variant_ids if present
    if (variantIdsFromCampaign.length) {
      for (const variantId of variantIdsFromCampaign) {
        try {
          const vResp = await shopifyFetch(`/variants/${variantId}.json`, { method: 'GET' });
          if (!vResp.ok) {
            const t = await vResp.text();
            console.error('Failed to fetch variant for rollback-campaign', variantId, vResp.status, t);
            errors.push({ variant_id: variantId, error: `Variant fetch error ${vResp.status}` });
            continue;
          }

          const vData = await vResp.json();
          const v = vData?.variant;
          if (!v || !v.compare_at_price) continue;

          const payload = {
            variant: {
              id: variantId,
              price: v.compare_at_price,
              compare_at_price: null
            }
          };

          const upResp = await shopifyFetch(`/variants/${variantId}.json`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });

          if (!upResp.ok) {
            const t = await upResp.text();
            console.error('Rollback-campaign update error', variantId, upResp.status, t);
            errors.push({
              variant_id: variantId,
              error: `Rollback update error ${upResp.status}`
            });
          } else {
            restored++;
          }
        } catch (err) {
          console.error('Rollback-campaign variant loop error', variantId, err);
          errors.push({ variant_id: variantId, error: err.message || String(err) });
        }
      }
    } else if (productIds.length) {
      // Fallback: your previous product-based logic
      for (const productId of productIds) {
        try {
          const pResp = await shopifyFetch(`/products/${productId}.json`, { method: 'GET' });

          if (!pResp.ok) {
            const t = await pResp.text();
            console.error('Failed to fetch product for rollback-campaign', productId, pResp.status, t);
            errors.push({ product_id: productId, error: `Product fetch error ${pResp.status}` });
            continue;
          }

          const pData = await pResp.json();
          const prod  = pData?.product;
          if (!prod || !Array.isArray(prod.variants)) continue;

          for (const v of prod.variants) {
            const variantId = v.id;
            const compareAt = v.compare_at_price;

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
              const t = await upResp.text();
              console.error('Rollback-campaign update error', variantId, upResp.status, t);
              errors.push({
                variant_id: variantId,
                error: `Rollback update error ${upResp.status}`
              });
            } else {
              restored++;
            }
          }
        } catch (err) {
          console.error('Rollback-campaign product loop error', productId, err);
          errors.push({ product_id: productId, error: err.message || String(err) });
        }
      }
    } else {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, error: 'Campaign has no products recorded' })
      };
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
    console.error('rollback-campaign function error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: 'Server error in rollback-campaign function'
      })
    };
  }
};
