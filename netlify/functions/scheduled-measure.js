export const config = { schedule: "0 6 * * *" }; // daily placeholder for measurement rollups & optional rollback
import { blobs } from '@netlify/blobs';
import { fetchOrdersSince, kpisForWeek, learnHeroes } from './_analytics.js';
import { gql } from './_shopify.js';

export default async function handler(req, res){
  const store = blobs();
  const today = new Date();
  const lastWeek = new Date(today.getTime() - 7*24*3600*1000).toISOString().slice(0,10);
  const promo = await store.getJSON(`promo_weeks/${lastWeek}.json`);
  if(!promo?.items?.length || promo.status!=='published'){
    return res.status(200).json({ ok:true, note:'no published promo at +7d' });
  }
  const orders = await fetchOrdersSince(56);
  const k = kpisForWeek(promo.items, orders);
  await store.setJSON(`metrics/${lastWeek}.json`, { week:lastWeek, ...k, computedAt:new Date().toISOString() });

  // Optional auto-rollback could be added here by calling the rollback function logic

  // Hero learning
  const byVar = {};
  for(const o of orders){
    for(const li of o.lineItems.nodes){
      const vid = li.variant?.id; if(!vid) continue;
      byVar[vid] = (byVar[vid]||0) + (li.quantity||0);
    }
  }
  const perf = promo.items.map(it => ({ product_id: it.product_id, units: byVar[it.variant_id]||0 }));
  const heroes = learnHeroes(perf);
  if(heroes.size>0){
    const MU = `#graphql
      mutation SetHero($ownerId:ID!){
        metafieldsSet(metafields:[{ownerId:$ownerId, namespace:"custom", key:"hero", value:"true", type:"boolean"}]){
          userErrors{ field message }
        }
      }`;
    for(const pid of heroes){
      await gql(MU, { ownerId: pid });
    }
  }

  return res.status(200).json({ ok:true, measured:true });
}
