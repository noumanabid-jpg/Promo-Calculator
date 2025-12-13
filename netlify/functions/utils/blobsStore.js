// netlify/functions/utils/blobsStore.js
let getStoreFn = null;

try {
  ({ getStore: getStoreFn } = require("@netlify/blobs"));
} catch (e) {
  // If module isn't available, we'll just return null stores.
}

function getCampaignStore() {
  if (!getStoreFn) return null;

  const siteID =
    process.env.NETLIFY_SITE_ID ||
    process.env.BLOBS_SITE_ID ||
    process.env.SITE_ID;

  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||   // ✅ your env var name
    process.env.BLOBS_TOKEN ||
    process.env.NETLIFY_AUTH_TOKEN;

  if (!siteID || !token) return null;

  return getStoreFn("promo-campaigns", { siteID, token });
}

module.exports = { getCampaignStore };
