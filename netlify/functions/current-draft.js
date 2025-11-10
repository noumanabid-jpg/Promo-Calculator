import { blobs } from '@netlify/blobs';
export default async function handler(req, res){
  const week = new Date().toISOString().slice(0,10);
  const store = blobs();
  const key = `promo_weeks/${week}.json`;
  const data = await store.getJSON(key);
  res.setHeader('Content-Type','application/json');
  return res.status(200).end(JSON.stringify(data || { week, items: [], status:'draft' }));
}
