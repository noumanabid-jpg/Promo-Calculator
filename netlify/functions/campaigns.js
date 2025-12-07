// netlify/functions/campaigns.js

let getStoreSafe = null;
try {
  ({ getStore: getStoreSafe } = require('@netlify/blobs'));
} catch (e) {
  console.warn('Blobs not available, /api/campaigns will return empty list');
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (!getStoreSafe) {
      // Blobs not configured (eg. local dev without use_netlify_blobs)
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
      if (raw) {
        campaigns = JSON.parse(raw) || [];
      }
    } catch (e) {
      console.error('Failed to read or parse campaigns index', e);
      campaigns = [];
    }

    // Optional: sort newest first by created_at
    campaigns.sort((a, b) => {
      const da = new Date(a.created_at || a.id || 0).getTime();
      const db = new Date(b.created_at || b.id || 0).getTime();
      return db - da;
    });

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
