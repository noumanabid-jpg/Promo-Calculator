// netlify/functions/enrich-cost.js

exports.handler = async (event) => {
  try {
    const shop = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    if (!shop || !token) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Shopify credentials" })
      };
    }

    const variantId = event.queryStringParameters?.variant_id;
    if (!variantId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "variant_id is required" })
      };
    }

    // 1. Get variant → extract inventory_item_id
    const variantUrl = `https://${shop}/admin/api/2024-07/variants/${variantId}.json`;

    const variantResp = await fetch(variantUrl, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      }
    });

    if (!variantResp.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Could not fetch variant info" })
      };
    }

    const variantData = await variantResp.json();
    const invItemId = variantData?.variant?.inventory_item_id;

    if (!invItemId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "inventory_item_id not found" })
      };
    }

    // 2. Fetch inventory item → cost
    const invUrl = `https://${shop}/admin/api/2024-07/inventory_items/${invItemId}.json`;

    const invResp = await fetch(invUrl, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      }
    });

    if (!invResp.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Could not fetch inventory item" })
      };
    }

    const invData = await invResp.json();
    const cost = Number(invData?.inventory_item?.cost ?? 0);

    return {
      statusCode: 200,
      body: JSON.stringify({
        cost,
        inventory_item_id: invItemId
      })
    };

  } catch (err) {
    console.error("enrich-cost error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" })
    };
  }
};
