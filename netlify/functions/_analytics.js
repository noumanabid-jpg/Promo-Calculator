import { gql, money } from './_shopify.js';

export async function fetchOrdersSince(days=56){
  const since = new Date(Date.now() - days*24*3600*1000).toISOString();
  const Q = `#graphql
    query Orders($query:String!, $first:Int!){
      orders(first:$first, query:$query, sortKey:PROCESSED_AT, reverse:true){
        nodes{
          id processedAt customer { id } totalPriceSet { shopMoney { amount } }
          lineItems(first:100){
            nodes{
              id quantity
              discountedTotalSet { shopMoney { amount } }
              originalTotalSet { shopMoney { amount } }
              variant { id product { id productType title } title sku }
            }
          }
        }
      }
    }`;
  const data = await gql(Q, { query: `processed_at:>=${since}`, first: 100 });
  return data.orders.nodes || [];
}

export function kpisForWeek(weekItems, orders){
  // Map variantId -> metrics in promo window (approx: use all orders for MVP; in prod, filter by date range)
  const byVariant = {};
  for(const o of orders){
    for(const li of o.lineItems.nodes){
      const vid = li.variant?.id;
      if(!vid) continue;
      if(!byVariant[vid]) byVariant[vid] = { units:0, revenue:0, buyers:new Set(), orig:0, disc:0 };
      byVariant[vid].units += li.quantity||0;
      byVariant[vid].revenue += money(li.discountedTotalSet?.shopMoney?.amount);
      byVariant[vid].orig += money(li.originalTotalSet?.shopMoney?.amount);
      byVariant[vid].disc += money(li.originalTotalSet?.shopMoney?.amount) - money(li.discountedTotalSet?.shopMoney?.amount);
      if(o.customer?.id) byVariant[vid].buyers.add(o.customer.id);
    }
  }
  let units=0, revenue=0, markdown=0;
  for(const it of weekItems){
    const m = byVariant[it.variant_id] || { units:0, revenue:0, buyers:new Set(), orig:0, disc:0 };
    units += m.units;
    revenue += m.revenue;
    markdown += m.disc;
  }
  const gm = revenue>0 ? 100 * (revenue - markdown) / revenue : 0; // placeholder GM%
  // Retention proxy: share of buyers who appear in any other orders (not robust; placeholder)
  const buyers = new Set();
  for(const it of weekItems){
    const m = byVariant[it.variant_id];
    if(m) m.buyers.forEach(b=>buyers.add(b));
  }
  const retention14 = 0; // compute in scheduled job with future orders; set 0 here
  const ordersCount = 0; // can be computed by scanning orders that contain any variant
  return { units, revenue, gm, markdown, orders: ordersCount, retention14 };
}

export function learnHeroes(resultItems){
  // Mark top quartile by units as heroes
  const arr = [...resultItems].sort((a,b)=> (b.units||0)-(a.units||0));
  if(arr.length<4) return new Set();
  const cutoff = arr[Math.floor(arr.length/4)].units||0;
  const set = new Set(arr.filter(x => (x.units||0) >= cutoff).map(x => x.product_id));
  return set;
}
