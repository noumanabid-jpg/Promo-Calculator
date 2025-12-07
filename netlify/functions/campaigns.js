// netlify/functions/campaigns.js

let getStoreSafe = null;
let connectLambdaSafe = null;
try {
  ({ getStore: getStoreSafe, connectLambda: connectLambdaSafe } = require('@netlify/blobs'));
} catch (e) {
  console.warn('[campaigns] Blobs not available, /api/campaigns will return empty list', e);
}

exports.handler = async (event) => {
  // Initialise blobs env in Lambda-compat mode
  if (connectLambdaSafe) {
    try {
      connectLambdaSafe(event);
    } catch (e) {
      console.warn('[campaigns] connectLambda failed', e);
    }
  }

  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (!getStoreSafe) {
      console.log('[campaigns] getStoreSafe is null – Blobs disabled or not configured');
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          campaigns: [],
          blobsEnabled: false
        })
      };
    }

    const store = getStoreSafe('promo-campaigns');

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
