import { blobs } from '@netlify/blobs';
import { fetchOrdersSince, kpisForWeek, learnHeroes } from './_analytics.js';
import { gql } from './_shopify.js';

export default async function handler(req, res){
  const store = blobs();
  const week = new Date().toISOString().slice(0,10);
  const draft = await store.getJSON(`promo_weeks/${week}.json`);

  // Compute KPIs from orders (last 8 weeks proxy)
  const orders = await fetchOrdersSince(56);
  let weeks = [];
  if(draft?.items?.length){
    const k = kpisForWeek(draft.items, orders);
    weeks.push({ week, items: draft.items.length, ...k, status: draft.status||'draft' });
  }

  // Hero learning: mark top quartile performers (if published and results known)
  if(draft?.status === 'published'){
    // Build per-item simple units aggregate from orders and set hero metafield for top quartile product_ids
    const perf = [];
    const byVariant = {};
    for(const o of orders){
      for(const li of o.lineItems.nodes){
        const vid = li.variant?.id; if(!vid) continue;
        byVariant[vid] = (byVariant[vid]||0) + (li.quantity||0);
      }
    }
    for(const it of draft.items){
      perf.push({ product_id: it.product_id, units: byVariant[it.variant_id]||0 });
    }
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
  }

  res.setHeader('Content-Type','application/json');
  return res.status(200).end(JSON.stringify({ weeks }));
}
