import { blobs } from '@netlify/blobs';
import { gql, money } from './_shopify.js';
import { roundPsych, applyGuardrails, normalize, scoreVariant } from './_engine.js';
import { recentAppearances } from './_fatigue.js';
import { fetchOrdersSince } from './_analytics.js';

const COST_NS = process.env.COST_METAFIELD_NAMESPACE || 'custom';
const COST_KEY = process.env.COST_METAFIELD_KEY || 'cost_sar';
const DO_NOT = (process.env.DO_NOT_DISCOUNT_TAG || 'do_not_discount').toLowerCase();
const TOP_FRUIT = Number(process.env.SUGGESTION_TOPN_FRUIT || 6);
const TOP_VEG   = Number(process.env.SUGGESTION_TOPN_VEG   || 6);

export default async function handler(req, res){
  try{
    const week = new Date().toISOString().slice(0,10);

    // Fetch products/variants + cost metafield
    const Q = `#graphql
      query VariantsForPromo($first:Int!){
        products(first:$first){
          nodes{
            id title productType tags
            variants(first:50){
              nodes{
                id title sku price: price compareAtPrice inventoryQuantity
                metafields(identifiers:[{namespace:"${COST_NS}", key:"${COST_KEY}"}]){ key namespace type value }
              }
            }
          }
        }
      }`;
    const data = await gql(Q, { first: 200 });

    // Fetch orders last 8 weeks for velocity signal
    const orders = await fetchOrdersSince(56);
    const orderUnitsByVariant = {};
    for(const o of orders){
      for(const li of o.lineItems.nodes){
        const id = li.variant?.id; if(!id) continue;
        orderUnitsByVariant[id] = (orderUnitsByVariant[id]||0) + (li.quantity||0);
      }
    }

    const all = [];
    for(const p of data.products.nodes){
      const category = (p.productType||'other').toLowerCase();
      const tagset = (p.tags||[]).map(t=>String(t).toLowerCase());
      const skip = tagset.includes(DO_NOT);
      for(const v of p.variants.nodes){
        const m = (v.metafields||[])[0];
        const cost = money(m?.value);
        const velocity = orderUnitsByVariant[v.id] || 0;
        all.push({
          product_id: p.id, title: p.title, category, tags: tagset,
          variant_id: v.id, variant: v.title, sku: v.sku,
          price: money(v.price), compare_at: money(v.compareAtPrice),
          inventory: Number(v.inventoryQuantity||0),
          cost, skip, hero: tagset.includes('hero'),
          velocity
        });
      }
    }

    // Normalize metrics
    const velVals = all.map(x=>x.velocity); const vmin = Math.min(...velVals, 0); const vmax = Math.max(...velVals, 1);
    const invVals = all.map(x=>x.inventory); const imin = Math.min(...invVals, 0); const imax = Math.max(...invVals, 1);

    // Build enriched with fatigue control
    const enriched = [];
    for(const x of all){
      if(x.skip || x.cost<=0 || x.price<=0 || x.price<=x.cost) continue;
      const marginHeadroom = x.price>0? (x.price - x.cost)/x.price : 0;
      const stockPressure = x.inventory; // using absolute inventory (normalize below)
      const appearances = await recentAppearances(x.variant_id, 8);
      const consecutive = appearances.length; // approx count; precise needs date continuity
      if(consecutive > 2) continue; // fatigue control: avoid >2 consecutive weeks

      const obj = {
        ...x,
        marginHeadroomNorm: normalize(marginHeadroom, 0, 0.5),
        stockPressureNorm: normalize(stockPressure, imin, imax),
        velocityNorm: normalize(x.velocity, vmin, vmax),
        heroBoost: x.hero ? 1 : 0
      };
      obj.score = scoreVariant(obj);
      enriched.push(obj);
    }

    const fruits = enriched.filter(x => x.category.includes('fruit')).sort((a,b)=>b.score-a.score).slice(0, TOP_FRUIT);
    const vegs   = enriched.filter(x => x.category.includes('vegetable')).sort((a,b)=>b.score-a.score).slice(0, TOP_VEG);
    const picks = [...fruits, ...vegs];

    const out = [];
    for(const it of picks){
      const floor = applyGuardrails({ price: it.price, cost: it.cost });
      if(!floor.ok) continue;
      const promo_price = floor.promo;
      const margin_promo = (promo_price - it.cost)/promo_price;
      out.push({ ...it, promo_price, margin_promo, round_rule: '.50/.95', flags: [] });
    }

    // Save draft
    const store = blobs();
    await store.setJSON(`promo_weeks/${week}.json`, { week, items: out, status: 'draft' });

    res.setHeader('Content-Type','application/json');
    return res.status(200).end(JSON.stringify({ week, items: out }));
  }catch(e){
    return res.status(500).json({ error:String(e) });
  }
}
