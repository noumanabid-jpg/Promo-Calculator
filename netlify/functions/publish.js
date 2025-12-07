// netlify/functions/publish.js

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
        body: JSON.stringify({ ok: false, error: 'Missing SHOPIFY_STORE or SHOPIFY_ADMIN_ACCESS_TOKEN' })
      }
    }

    const body = event.body ? JSON.parse(event.body) : {}
    const items = Array.isArray(body.items) ? body.items : []

    if (!items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'No items to publish' })
      }
    }

    let updated = 0
    const errors = []

    // Helper to call Shopify REST Admin
    async function updateVariantPrice(variantId, price, compareAtPrice) {
      const url = `https://${shop}/admin/api/2024-07/variants/${variantId}.json`

      const payload = {
        variant: {
          id: variantId,
          price: price
        }
      }

      // Only send compare_at_price if we actually have it
      if (compareAtPrice != null) {
        payload.variant.compare_at_price = compareAtPrice
      }

      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`Shopify error ${resp.status}: ${text}`)
      }
    }

    // Logic: we assume draft items contain:
    // - price       = regular price
    // - promo_price = discount price
    // On publish, we set:
    // - variant.price           = promo_price
    // - variant.compare_at_price = price
    for (const it of items) {
      const variantId = it.variant_id
      if (!variantId) continue

      const regular = Number(it.price ?? 0)
      const promo   = Number(it.promo_price ?? 0)

      // If no promo price, skip
      if (!promo || promo <= 0) continue

      try {
        await updateVariantPrice(variantId, promo, regular > 0 ? regular : null)
        updated++
      } catch (err) {
        console.error('Failed to update variant', variantId, err.message || err)
        errors.push({ variant_id: variantId, error: err.message || String(err) })
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: errors.length === 0,
        updated,
        errors
      })
    }
  } catch (err) {
    console.error('publish function error', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Server error in publish function' })
    }
  }
}
