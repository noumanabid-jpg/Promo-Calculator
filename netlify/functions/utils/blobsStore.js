// netlify/functions/utils/blobsStore.js

let getStoreSafe = null;

try {
  ({ getStore: getStoreSafe } = require("@netlify/blobs"));
} catch (e) {
  console.warn("[blobsStore] @netlify/blobs not available:", e?.message || e);
}

function getCampaignStore() {
  if (!getStoreSafe) {
    console.warn("[blobsStore] getStore is not available (module failed to load)");
    return null;
  }

  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN; // manual mode token (Netlify PAT)

  console.log("[blobsStore] Env check:", {
    NETLIFY_SITE_ID: siteID ? "present" : "missing",
    NETLIFY_BLOBS_TOKEN: token ? "present" : "missing",
  });

  if (!siteID || !token) return null;

  // ✅ Manual mode: must be exactly { siteID, token }
  return getStoreSafe("promo-campaigns", { siteID, token });
}

module.exports = { getCampaignStore };
