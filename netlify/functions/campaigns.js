// netlify/functions/campaigns.js

let getStoreSafe = null;
try {
  ({ getStore: getStoreSafe } = require('@netlify/blobs'));
} catch (e) {
  console.warn('[campaigns] @netlify/blobs not available', e);
}

function getCampaignStore() {
  if (!getStoreSafe) {
    console.warn('[campaigns] getStoreSafe is null');
    return null;
  }

  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;

  if (!siteID || !token) {
    console.warn('[campaigns] Missing NETLIFY_SITE_ID or NETLIFY_BLOBS_TOKEN');
    return null;
  }

  try {
    return getStoreSafe('promo-campaigns', { siteID, token });
  } catch (e) {
    console.error('[campaigns] getStore failed', e);
    return null;
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const store = getCampaignStore();
    if (!store) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          campaigns: [],
          blobsEnabled: false
        })
      };
    }

    let campaigns = [];
    try {
      const raw = await store.get('index');
      console.log('[campaigns] raw index:', raw);
      if (raw) {
        campaigns = JSON.parse(raw) || [];
      }
    } catch (e) {
      console.error('[campaigns] Failed to read or parse campaigns index', e);
      campaigns = [];
    }

    campaigns.sort((a, b) => {
      const da = new Date(a.created_at || a.id || 0).getTime();
      const db = new Date(b.created_at || b.id || 0).getTime();
      return db - da;
    });

    console.log('[campaigns] returning', campaigns.length, 'campaign(s)');

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        campaigns,
        blobsEnabled: true
      })
    };
  } catch (err) {
    console.error('/campaigns error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        campaigns: [],
        error: 'Server error'
      })
    };
  }
};
