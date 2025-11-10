import { blobs } from '@netlify/blobs';
import { gql } from './_shopify.js';

export default async function handler(req, res){
  try{
    const week = new Date().toISOString().slice(0,10);
    const store = blobs();
    const snap = await store.getJSON(`price_snapshots/${week}.json`);
    if(!snap?.variants?.length) return res.status(400).json({ error:'No snapshot' });

    const MU = `#graphql
      mutation UpdateVariantPrice($id:ID!, $price:Money, $compareAtPrice:Money){
        productVariantUpdate(input:{ id:$id, price:$price, compareAtPrice:$compareAtPrice }){
          userErrors{ field message }
        }
      }`;
    for(const v of snap.variants){
      await gql(MU, { id: v.variant_id, price: v.old_price, compareAtPrice: v.old_compare_at || null });
    }
    await store.setJSON(`promo_weeks/${week}.json`, { week, status:'reverted', revertedAt:new Date().toISOString() });
    return res.status(200).json({ ok:true, restored: snap.variants.length });
  }catch(e){
    return res.status(500).json({ error:String(e) });
  }
}
