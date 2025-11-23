// netlify/functions/generate-draft.js
// Minimal, safe version: no Shopify, no Blobs — just returns mock items
// in the exact shape the UI expects, so the front end works.

const mockItems = () => {
  const mk = (o) => ({
    product_id: o.product_id || "gid://shopify/Product/1",
    title: o.title,
    category: o.category,
    tags: o.tags || [],
    variant_id: o.variant_id || "gid://shopify/ProductVariant/1",
    variant: o.variant,
    sku: o.sku,
    price: o.price,
    compare_at: o.compare_at || 0,
    inventory: o.inventory ?? 100,
    cost: o.cost,
    skip: false,
    hero: o.hero || false,
    velocity: o.velocity || 0,
    flags: o.flags || [],
    promo_price: o.promo_price,
    margin_promo: (o.promo_price - o.cost) / o.promo_price,
    round_rule: ".50/.95"
  });

  return [
    mk({ title: "Strawberries", category: "fruit", variant: "Jeddah", sku: "STB-JED", price: 24.95, cost: 18.0, promo_price: 19.95 }),
    mk({ title: "Grapes Red", category: "fruit", variant: "Jeddah", sku: "GRP-JED", price: 19.95, cost: 14.0, promo_price: 15.95 }),
    mk({ title: "Mango Chaunsa", category: "fruit", variant: "Jeddah", sku: "MNG-JED", price: 29.95, cost: 21.0, promo_price: 23.95 }),
    mk({ title: "Oranges Valencia", category: "fruit", variant: "Jeddah", sku: "ORG-JED", price: 14.95, cost: 10.0, promo_price: 11.95 }),
    mk({ title: "Banana", category: "fruit", variant: "Jeddah", sku: "BAN-JED", price: 8.95, cost: 6.0, promo_price: 6.95 }),
    mk({ title: "Apple Royal Gala", category: "fruit", variant: "Jeddah", sku: "APL-JED", price: 17.95, cost: 12.0, promo_price: 13.95 }),

    mk({ title: "Tomato", category: "vegetable", variant: "Jeddah", sku: "TMT-JED", price: 7.95, cost: 5.0, promo_price: 6.50 }),
    mk({ title: "Cucumber", category: "vegetable", variant: "Jeddah", sku: "CUC-JED", price: 6.95, cost: 4.5, promo_price: 5.50 }),
    mk({ title: "Onion", category: "vegetable", variant: "Jeddah", sku: "ONN-JED", price: 5.95, cost: 3.5, promo_price: 4.50 }),
    mk({ title: "Potato", category: "vegetable", variant: "Jeddah", sku: "PTT-JED", price: 6.95, cost: 4.0, promo_price: 5.50 }),
    mk({ title: "Carrot", category: "vegetable", variant: "Jeddah", sku: "CRT-JED", price: 9.95, cost: 6.0, promo_price: 7.95 }),
    mk({ title: "Broccoli", category: "vegetable", variant: "Jeddah", sku: "BRC-JED", price: 15.95, cost: 10.0, promo_price: 12.95 })
  ];
};

export default async function handler(request, context) {
  try {
    const week = new Date().toISOString().slice(0, 10);
    const items = mockItems();

    return new Response(
      JSON.stringify({
        week,
        items,
        debug: { mode: "mock", count: items.length }
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
