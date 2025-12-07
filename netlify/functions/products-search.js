// netlify/functions/products-search.js

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' }
    }

    const shop  = process.env.SHOPIFY_STORE
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

    if (!shop || !token) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Missing SHOPIFY_STORE or SHOPIFY_ADMIN_ACCESS_TOKEN' })
      }
    }

    const q = event.queryStringParameters?.q || ''
    const trimmed = q.trim()
    if (!trimmed) {
      return {
        statusCode: 200,
        body: JSON.stringify({ items: [] })
      }
    }

    // Build Shopify search query:
    // if you search "12345" it will hit sku:12345
    // if you search "banana", it will hit title:*banana*
    const searchQuery = `sku:${trimmed} OR title:*${trimmed}*`

    const graphqlEndpoint = `https://${shop}/admin/api/2024-07/graphql.json`

    const graphqlBody = {
      query: `
        query SearchProducts($query: String!) {
          products(first: 20, query: $query) {
            edges {
              node {
                id
                title
                productType
                variants(first: 30) {
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
      `,
      variables: {
        query: searchQuery
      }
    }

    const resp = await fetch(graphqlEndpoint, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(graphqlBody)
    })

    if (!resp.ok) {
      const text = await resp.text()
      console.error('products-search HTTP error', resp.status, text)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Shopify GraphQL error' })
      }
    }

    const data = await resp.json()
    if (data.errors) {
      console.error('products-search GraphQL errors', data.errors)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Shopify GraphQL error' })
      }
    }

    const edges = data?.data?.products?.edges || []
    const items = []

    for (const e of edges) {
      const product = e?.node
      if (!product) continue

      const productId = product.id
      const productTitle = product.title
      const productType = product.productType || ''

      const varEdges = product.variants?.edges || []
      for (const ve of varEdges) {
        const v = ve?.node
        if (!v) continue

        items.push({
          id: productId,
          product_title: productTitle,
          title: productTitle,          // used in UI
          variant_id: v.id?.replace('gid://shopify/ProductVariant/', ''), // numeric ID
          variant: v.title,
          sku: v.sku,
          price: Number(v.price ?? 0),
          category: productType,
          // promo_price, cost, flags, round_rule will be derived later in the app if needed
        })
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ items })
    }
  } catch (err) {
    console.error('products-search function error', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error in products-search' })
    }
  }
}
