import { blobs } from '@netlify/blobs';
import { gql } from './_shopify.js';

export default async function handler(req, res){
  try{
    const week = new Date().toISOString().slice(0,10);
    const store = blobs();
    const draft = await store.getJSON(`promo_weeks/${week}.json`);
    if(!draft?.items?.length) return res.status(400).json({ error:'No draft' });

    // Group by product_id to enforce nationwide sync (all city variants same promo price)
    const byProduct = new Map();
    for(const it of draft.items){
      if(!byProduct.has(it.product_id)) byProduct.set(it.product_id, it.promo_price);
      else byProduct.set(it.product_id, Math.min(byProduct.get(it.product_id), it.promo_price)); // choose lowest among selected
    }

    // Fetch variants for each product and apply same promo
    const QProd = `#graphql
      query OneProduct($id:ID!){ product(id:$id){ id variants(first:100){ nodes{ id price compareAtPrice } } } }`;
    const MU = `#graphql
      mutation UpdateVariantPrice($id:ID!, $price:Money, $compareAtPrice:Money){
        productVariantUpdate(input:{ id:$id, price:$price, compareAtPrice:$compareAtPrice }){
          userErrors{ field message }
        }
      }`;
    const snapshots = [];

    for(const [productId, targetPromo] of byProduct.entries()){
      const prod = await gql(QProd, { id: productId });
      for(const v of prod.product.variants.nodes){
        snapshots.push({ variant_id: v.id, old_price: v.price, old_compare_at: v.compareAtPrice });
        await gql(MU, { id: v.id, price: targetPromo, compareAtPrice: v.price });
      }
    }

    await store.setJSON(`price_snapshots/${week}.json`, { week, at: new Date().toISOString(), variants: snapshots });
    await store.setJSON(`promo_weeks/${week}.json`, { ...draft, status:'published', publishedAt:new Date().toISOString() });
    return res.status(200).json({ ok:true, products: byProduct.size, variants: snapshots.length });
  }catch(e){
    return res.status(500).json({ error:String(e) });
  }
}
