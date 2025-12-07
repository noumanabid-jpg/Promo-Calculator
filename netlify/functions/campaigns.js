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
      return {
        statusCode: 200,
        body: JSON.stringify({ campaigns: [] })
      };
    }

    const store = getStoreSafe('promo-campaigns');
    const raw   = await store.get('index');

    if (!raw) {
      return {
        statusCode: 200,
        body: JSON.stringify({ campaigns: [] })
      };
    }

    let campaigns = [];
    try {
      campaigns = JSON.parse(raw) || [];
    } catch (e) {
      console.error('Failed to parse campaigns index', e);
      campaigns = [];
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ campaigns })
    };
  } catch (err) {
    console.error('/campaigns error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ campaigns: [], error: 'Server error' })
    };
  }
};
