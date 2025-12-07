// netlify/functions/products-search.js

// Netlify (Node 18+) already has global fetch available – no imports needed.

exports.handler = async (event) => {
  try {
    const shop = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    if (!shop || !token) {
      console.error('Missing env vars', { shop, hasToken: !!token });
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Missing SHOPIFY_STORE or SHOPIFY_ADMIN_ACCESS_TOKEN' }),
      };
    }

    const q = (event.queryStringParameters?.q || '').trim();
    if (!q) {
      return {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      };
    }

    // Use REST Admin API to get products + variants, then filter by title/SKU in JS
    const url = `https://${shop}/admin/api/2024-07/products.json?limit=50&status=active&fields=id,title,product_type,variants`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Shopify REST error', resp.status, text);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Shopify REST error', status: resp.status }),
      };
    }

    const data = await resp.json();
    const products = data.products || [];
    const qLower = q.toLowerCase();

    const items = products.flatMap((p) => {
      const matchesTitle = (p.title || '').toLowerCase().includes(qLower);
      const vEdges = p.variants || [];

      return vEdges
        .filter((v) => {
          const sku = (v.sku || '').toLowerCase();
          const vTitle = (v.title || '').toLowerCase();
          return matchesTitle || sku.includes(qLower) || vTitle.includes(qLower);
        })
        .map((v) => {
          const price = Number(v.price ?? 0);
          const cost = 0; // you can later enrich this from ERP if needed
          const promo = price;
          const margin_promo = promo > 0 ? (promo - cost) / promo : 0;

          return {
            id: p.id,
            variant_id: v.id,
            title: p.title,
            variant: v.title,
            sku: v.sku,
            category: p.product_type || '',
            price,
            cost,
            promo_price: promo,
            margin_promo,
            round_rule: '',
            flags: [],
          };
        });
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ items }),
    };
  } catch (err) {
    console.error('products-search error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' }),
    };
  }
};
