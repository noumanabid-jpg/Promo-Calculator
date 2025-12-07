// netlify/functions/publish.js

// Try to load Netlify Blobs, but don't fail if it's not available
let getStoreSafe = null
try {
  ;({ getStore: getStoreSafe } = require('@netlify/blobs'))
} catch (e) {
  console.warn('Blobs not available, campaign history will be disabled')
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' }
    }

    const shop  = process.env.SHOPIFY_STORE
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN       // ✅ FIXED HERE

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
    const week  = body.week || null

    if (!items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'No items to publish' })
      }
    }

    // Helper to call Shopify REST Admin
    async function shopifyFetch (path, opts = {}) {
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

    // 1) Build map: productId -> { regular, promo }
    const productConfig    = new Map()   // productId -> { regular, promo }
    const variantToProduct = new Map()   // variantId -> productId

    for (const it of items) {
      const variantId = it.variant_id
      const regular   = Number(it.price ?? 0)
      const promo     = Number(it.promo_price ?? 0)

      if (!variantId || !promo || promo <= 0) continue

      let productId = variantToProduct.get(variantId)

      if (!productId) {
        // lookup variant to find its product_id
        const vResp = await shopifyFetch(`/variants/${variantId}.json`, { method: 'GET' })

        if (!vResp.ok) {
          const t = await vResp.text()
          console.error('Failed to fetch variant', variantId, vResp.status, t)
          continue
        }

        const vData = await vResp.json()
        productId = vData?.variant?.product_id
        if (!productId) continue

        variantToProduct.set(variantId, productId)
      }

      // For now, first promo for a product wins
      if (!productConfig.has(productId)) {
        productConfig.set(productId, { regular, promo })
      }
    }

    if (!productConfig.size) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          error: 'No valid promo items found (missing variant_id or promo_price)'
        })
      }
    }

    // 2) For each product, fetch all variants & update them
    let updated = 0
    const errors = []

    for (const [productId, cfg] of productConfig.entries()) {
      try {
        const pResp = await shopifyFetch(`/products/${productId}.json`, { method: 'GET' })

        if (!pResp.ok) {
          const t = await pResp.text()
          console.error('Failed to fetch product', productId, pResp.status, t)
          errors.push({ product_id: productId, error: `Product fetch error ${pResp.status}` })
          continue
        }

        const pData = await pResp.json()
        const prod  = pData?.product
        if (!prod || !Array.isArray(prod.variants)) continue

        const { regular, promo } = cfg

        for (const v of prod.variants) {
          const variantId     = v.id
          const originalPrice = v.price

          const newPrice     = promo                     // same promo for all variants
          const newCompareAt = regular > 0 ? regular : originalPrice

          const payload = {
            variant: {
              id: variantId,
              price: newPrice,
              compare_at_price: newCompareAt
            }
          }

          const upResp = await shopifyFetch(`/variants/${variantId}.json`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          })

          if (!upResp.ok) {
            const t = await upResp.text()
            console.error('Failed to update variant', variantId, upResp.status, t)
            errors.push({
              variant_id: variantId,
              error: `Update error ${upResp.status}`
            })
          } else {
            updated++
          }
        }
      } catch (err) {
        console.error('Product loop error', productId, err)
        errors.push({ product_id: productId, error: err.message || String(err) })
      }
    }

    // 3) Record campaign (non-blocking, best-effort)
    if (getStoreSafe && productConfig.size) {
      try {
        const store = getStoreSafe('promo-campaigns')
        const id    = new Date().toISOString()
        const created_at = id
        const product_ids = Array.from(productConfig.keys())

        const campaign = {
          id,
          week,
          created_at,
          product_ids
        }

        // Save detailed campaign
        await store.set(`campaign:${id}`, JSON.stringify(campaign))

        // Update index (list of campaigns)
        let index = []
        const raw = await store.get('index')
        if (raw) {
          try { index = JSON.parse(raw) || [] } catch {}
        }

        index.unshift({
          id,
          week,
          created_at,
          product_count: product_ids.length
        })

        // keep last 50 campaigns
        index = index.slice(0, 50)

        await store.set('index', JSON.stringify(index))
      } catch (err) {
        console.error('Failed to write campaign history (non-fatal)', err)
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: errors.length === 0,
        updated,
        errors,
        week
      })
    }
  } catch (err) {
    console.error('publish function error', err)
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: 'Server error in publish function'
      })
    }
  }
}
