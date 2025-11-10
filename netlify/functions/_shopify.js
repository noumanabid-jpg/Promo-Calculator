import fetch from 'node-fetch';
const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_URL = `https://${SHOP}/admin/api/2024-10/graphql.json`;

export async function gql(query, variables={}){
  const r = await fetch(API_URL, {
    method:'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const data = await r.json();
  if(data.errors) throw new Error('Shopify GraphQL errors: ' + JSON.stringify(data.errors));
  return data.data;
}
export const money = (n)=>Math.max(0, Number(n||0));
