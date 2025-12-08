// netlify/functions/campaigns.js

/* ------------------ B L O B S   H E L P E R ------------------ */

let getStoreSafe = null;
try {
  ({ getStore: getStoreSafe } = require('@netlify/blobs'));
} catch (e) {
  console.warn('[campaigns] @netlify/blobs not available', e);
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
    console.warn('[campaigns] Missing env vars for Blobs');
    return null;
  }

  try {
    return getStoreSafe('promo-campaigns', { siteID, token });
  } catch (e) {
    console.error('[campaigns] getStore failed', e);
    return null;
  }
}

/* ------------------ H A N D L E R ------------------ */

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    const store = getCampaignStore();
    if (!store) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, campaigns: [], blobsEnabled: false })
      };
    }

    let campaigns = [];
    try {
      const raw = await store.get('index');
      if (raw) campaigns = JSON.parse(raw) || [];
    } catch (e) {
      console.error('[campaigns] Failed reading index', e);
      campaigns = [];
    }

    campaigns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        campaigns,
        blobsEnabled: true
      })
    };
  } catch (err) {
    console.error('[campaigns] Fatal error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, campaigns: [], error: 'Server error' })
    };
  }
};
