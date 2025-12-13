// netlify/functions/campaigns.js
const { getCampaignStore } = require("./utils/blobsStore");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const store = getCampaignStore();
    if (!store) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          campaigns: [],
          blobsEnabled: false,
          hint: "Set NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN in Netlify env vars (Functions/Runtime scope)."
        })
      };
    }

    const raw = await store.get("index");
    const campaigns = raw ? (JSON.parse(raw) || []) : [];

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        campaigns,
        blobsEnabled: true
      })
    };
  } catch (err) {
    console.error("campaigns error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, campaigns: [], error: "Server error" })
    };
  }
};
