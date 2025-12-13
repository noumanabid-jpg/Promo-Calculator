const { getStore } = require("@netlify/blobs");

exports.handler = async () => {
  try {
    const store = getStore("test-store", {
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    await store.set("hello", "world");
    const val = await store.get("hello");

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, val })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
};
