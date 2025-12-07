// netlify/functions/products-search.js
const { shopifyGraphql } = require('./utils/shopify.js')

exports.handler = async (event) => {
  try {
    const shop = process.env.SHOPIFY_STORE
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

    if (!shop || !token) {
      console.error('Missing env vars', { shop, hasToken: !!token })
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Missing SHOPIFY_STORE or SHOPIFY_ADMIN_ACCESS_TOKEN' })
      }
    }

    const q = (event.queryStringParameters?.q || '').trim()
    if (!q) {
      return {
        statusCode: 200,
        body: JSON.stringify({ items: [] })
      }
    }

    // Search by title or SKU
    const query = `#graphql
      query SearchProducts($query: String!) {
        products(first: 20, query: $query) {
          edges {
            node {
              id
              title
              productType
              variants(first: 5) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                  }
                }
              }
            }
          }
        }
      }
    `

    const searchQuery = `title:*${q}* OR sku:${q}*`

    const result = await shopifyGraphql({
      shop,
      token,
      query,
      variables: { query: searchQuery }
    })

    const edges = result?.data?.products?.edges || []
    const items = edges.flatMap((e) => {
      const node = e.node
      const vEdges = node.variants?.edges || []
      return vEdges.map((ve) => {
        const v = ve.node
        return {
          id: node.id,
          variant_id: v.id,
          title: node.title,
          variant: v.title,
          sku: v.sku,
          category: node.productType || '',
          price: Number(v.price ?? 0),
          cost: 0,
          promo_price: Number(v.price ?? 0),
          margin_promo: 0,
          round_rule: '',
          flags: []
        }
      })
    })

    return {
      statusCode: 200,
      body: JSON.stringify({ items })
    }
  } catch (err) {
    console.error('products-search error', err.response || err.message || err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' })
    }
  }
}
