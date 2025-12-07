// netlify/functions/rollback.js

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' }
    }

    const shop  = process.env.SHOPIFY_STORE
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

    if (!shop || !token) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: 'Missing SHOPIFY_STORE or SHOPIFY_ADMIN_ACCESS_TOKEN'
        })
      }
    }

    const body  = event.body ? JSON.parse(event.body) : {}
    const items = Array.isArray(body.items) ? body.items : []

    if (!items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'No items provided for rollback' })
      }
    }

    // Helper to call Shopify REST Admin
    async function shopifyFetch(path, opts = {}) {
      const url = `https://${shop}/admin/api/2024-07${path}`
      const resp = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        },
        ...opts
      })
      return resp
    }

    // 1) Build set of product IDs from the planner items (via their variant_ids)
    const productIds = new Set()
    const variantToProduct = new Map()

    for (const it of items) {
      const variantId = it.variant_id
      if (!variantId) continue

      let productId = variantToProduct.get(variantId)

      if (!productId) {
        const vResp = await shopifyFetch(`/variants/${variantId}.json`, { method: 'GET' })

        if (!vResp.ok) {
          const t = await vResp.text()
          console.error('Failed to fetch variant for rollback', variantId, vResp.status, t)
          continue
        }

        const vData = await vResp.json()
        productId = vData?.variant?.product_id
        if (!productId) continue

        variantToProduct.set(variantId, productId)
      }

      productIds.add(productId)
    }

    if (!productIds.size) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          error: 'No valid products found to rollback (missing variant_id/product_id)'
        })
      }
    }

    // 2) For each product, fetch all variants & rollback price = compare_at_price
    let restored = 0
    const errors = []

    for (const productId of productIds) {
      try {
        const pResp = await shopifyFetch(`/products/${productId}.json`, { method: 'GET' })

        if (!pResp.ok) {
          const t = await pResp.text()
          console.error('Failed to fetch product for rollback', productId, pResp.status, t)
          errors.push({ product_id: productId, error: `Product fetch error ${pResp.status}` })
          continue
        }

        const pData = await pResp.json()
        const prod  = pData?.product
        if (!prod || !Array.isArray(prod.variants)) continue

        for (const v of prod.variants) {
          const variantId = v.id
          const compareAt = v.compare_at_price

          // Only rollback if compare_at_price exists (this is our "original" price)
          if (!compareAt) continue

          const payload = {
            variant: {
              id: variantId,
              price: compareAt,
              compare_at_price: null
            }
          }

          const upResp = await shopifyFetch(`/variants/${variantId}.json`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          })

          if (!upResp.ok) {
            const t = await upResp.text()
            console.error('Rollback update error', variantId, upResp.status, t)
            errors.push({
              variant_id: variantId,
              error: `Rollback update error ${upResp.status}`
            })
          } else {
            restored++
          }
        }
      } catch (err) {
        console.error('Rollback product loop error', productId, err)
        errors.push({ product_id: productId, error: err.message || String(err) })
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: errors.length === 0,
        restored,
        errors
      })
    }
  } catch (err) {
    console.error('rollback function error', err)
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: 'Server error in rollback function'
      })
    }
  }
}
