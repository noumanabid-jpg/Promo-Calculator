import { blobs } from '@netlify/blobs';
export default async function handler(req, res){
  const week = new Date().toISOString().slice(0,10);
  const store = blobs();
  const draft = await store.getJSON(`promo_weeks/${week}.json`) || { items: [] };
  const rows = [['Variant ID','SKU','Title','Variant','Old Price','Promo Price','Compare_At','Category']];
  for(const it of draft.items){
    rows.push([it.variant_id, it.sku, it.title, it.variant, it.price, it.promo_price, it.price, it.category]);
  }
  const csv = rows.map(r => r.map(x => String(x).replaceAll('"','""')).map(x=>`"${x}"`).join(',')).join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="promo_${week}.csv"`);
  return res.status(200).end(csv);
}
