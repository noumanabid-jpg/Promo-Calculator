const { getStore } = require("@netlify/blobs");

exports.handler = async () => {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  // Log presence only (no secret leakage)
  console.log("[blobs-test] Env presence:", {
    NETLIFY_SITE_ID: siteID ? "present" : "missing",
    NETLIFY_BLOBS_TOKEN: token ? "present" : "missing",
    CONTEXT: process.env.CONTEXT || "unknown"
  });

  try {
    // If missing, stop early so it's obvious
    if (!siteID || !token) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          reason: "missing_env",
          seen: {
            NETLIFY_SITE_ID: !!siteID,
            NETLIFY_BLOBS_TOKEN: !!token,
            CONTEXT: process.env.CONTEXT || "unknown"
          }
        })
      };
    }

    const store = getStore("test-store", { siteID, token });

    await store.set("hello", "world");
    const val = await store.get("hello");

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, val })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: e.message,
        seen: {
          NETLIFY_SITE_ID: !!siteID,
          NETLIFY_BLOBS_TOKEN: !!token,
          CONTEXT: process.env.CONTEXT || "unknown"
        }
      })
    };
  }
};
