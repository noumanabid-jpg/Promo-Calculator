import React, { useEffect, useState, useCallback } from 'react'

const fmt = (n)=>Number(n??0).toFixed(2)
const pct = (n)=>`${(Number(n??0)*100).toFixed(1)}%`

function Chip({children}){
  return <span className="rounded-full border px-2 py-1 text-[11px] text-neutral-600">{children}</span>
}

export default function App(){
  const [tab, setTab] = useState('planner')
  const [draft, setDraft] = useState({ week: '', items: [] })
  const [items, setItems] = useState([])          // editable items
  const [loading, setLoading] = useState(false)
  const [csvHref, setCsvHref] = useState('')
  const [weeks, setWeeks] = useState([])
  const [msg, setMsg] = useState('')

  // NEW: search state for manual add
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')

  const weekKey = draft.week || new Date().toISOString().slice(0,10)

  const loadDraft = useCallback(async ()=>{
    try {
      const r = await fetch('/api/current-draft')
      const data = await r.json()
      const safe = data || { week:'', items:[] }
      setDraft(safe)
      setItems(safe.items || [])
    } catch (e) {
      console.error('current-draft error', e)
      setDraft({ week:'', items:[] })
      setItems([])
    }
  }, [])

  const manualDraft = useCallback(async ()=>{
    setLoading(true)
    try {
      const r = await fetch('/api/generate-draft-live?manual=1')
      const data = await r.json()
      setDraft(data || { week:'', items:[] })
      setItems((data && data.items) || [])
    } catch (e) {
      console.error('generate-draft-live error', e)
      setMsg('Failed to generate draft')
    } finally {
      setLoading(false)
    }
  }, [])

  const exportCsv = useCallback(async ()=>{
    try {
      const r = await fetch('/api/export-csv')
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      setCsvHref(url)
      setMsg('CSV ready — click the download link below.')
    } catch (e) {
      console.error('export-csv error', e)
      setMsg('Export CSV failed')
    }
  }, [])

const publish = useCallback(async ()=>{
  if (!items.length) {
    setMsg('No items to publish')
    return
  }

  try {
    const r = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week: weekKey,
        items
      })
    })

    const data = await r.json()
    if (data?.ok) {
      setMsg(`Published ${data.updated || 0} variants to Shopify`)
      loadDraft()
    } else {
      setMsg(data?.error || 'Publish failed')
    }
  } catch (e) {
    console.error('publish error', e)
    setMsg('Publish failed')
  }
}, [items, weekKey, loadDraft])

const rollback = useCallback(async ()=>{
  if (!items.length) {
    setMsg('No items to rollback')
    return
  }

  try {
    const r = await fetch('/api/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    })
    const data = await r.json()
    setMsg(data?.ok
      ? `Rollback done (restored ${data.restored || 0} variants)`
      : data?.error || 'Rollback failed'
    )
    loadDraft()
  } catch (e) {
    console.error('rollback error', e)
    setMsg('Rollback failed')
  }
}, [items, loadDraft])

  const loadResults = useCallback( async ()=>{
    try {
      const r = await fetch('/api/results')
      const data = await r.json()
      setWeeks(data?.weeks||[])
    } catch (e) {
      console.error('results error', e)
      setWeeks([])
    }
  }, [])

  // Save draft (week + edited items) to cloud via /api/save-draft
  const saveDraft = useCallback(async ()=>{
    if (!weekKey || !items.length) {
      setMsg('Nothing to save')
      return
    }
    try {
      const r = await fetch('/api/save-draft', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ week: weekKey, items })
      })
      const data = await r.json()
      setMsg(data?.ok ? 'Draft saved' : data?.error || 'Failed to save draft')
    } catch (e) {
      console.error('save-draft error', e)
      setMsg('Failed to save draft')
    }
  }, [weekKey, items])

  useEffect(()=>{ loadDraft(); loadResults(); }, [loadDraft, loadResults])

  // Update a field (price / promo_price / cost) & recalc margin_promo
  const updateItemField = (index, field, rawValue)=>{
    const value = rawValue === '' ? '' : Number(rawValue)

    setItems(prev =>
      prev.map((it, i)=>{
        if(i !== index) return it
        const next = { ...it, [field]: value }

        if(field === 'promo_price' || field === 'cost' || field === 'price'){
          const promo = Number(next.promo_price || 0)
          const cost  = Number(next.cost || 0)
          next.margin_promo = promo > 0 ? (promo - cost) / promo : 0
        }

        return next
      })
    )
  }

  // NEW: remove one item from the draft (suggested or manually added)
  const removeItem = (index)=>{
    setItems(prev => prev.filter((_, i)=> i !== index))
  }

  // NEW: search products by name/SKU via /api/products-search
  const searchProducts = useCallback(async ()=>{
    const q = searchTerm.trim()
    if (!q) return
    setSearchLoading(true)
    setSearchError('')
    try {
      const r = await fetch(`/api/products-search?q=${encodeURIComponent(q)}`)
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`)
      }
      const data = await r.json()
      // backend can return { items: [...] } or { products: [...] }
      const list = data.items || data.products || []
      setSearchResults(list)
    } catch (e) {
      console.error('products-search error', e)
      setSearchError('Could not fetch products. Please try again.')
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }, [searchTerm])

  // NEW: add a product from searchResults into items[]
  const addSearchResultToDraft = async (p) => {
  // 1) Fetch real cost from Shopify via /api/enrich-cost
  let fetchedCost = null;

  if (p.variant_id) {
    try {
      const res = await fetch(`/api/enrich-cost?variant_id=${p.variant_id}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.cost != null) {
          fetchedCost = Number(data.cost);
        }
      } else {
        console.error('enrich-cost HTTP error', res.status);
      }
    } catch (err) {
      console.error('enrich-cost fetch error', err);
    }
  }

  // 2) Update items list
  setItems(prev => {
    // avoid duplicates by variant_id or id+sku
    const exists = prev.some(it =>
      (p.variant_id && it.variant_id === p.variant_id) ||
      (p.id && it.id === p.id && p.sku && it.sku === p.sku)
    );
    if (exists) return prev;

    const price = Number(p.price ?? 0);
    const cost  = Number(
      fetchedCost ??   // real cost from inventory_item
      p.cost ??        // fallback from search API (if ever set)
      0
    );
    const promo = Number(p.promo_price ?? price);
    const margin_promo = promo > 0 ? (promo - cost) / promo : 0;

    const nextItem = {
      id: p.id,
      variant_id: p.variant_id,
      title: p.title || p.product_title || 'Untitled',
      variant: p.variant || p.variant_title || '',
      sku: p.sku || '',
      category: p.category || '',
      price,
      cost,
      promo_price: promo,
      margin_promo,
      round_rule: p.round_rule || '',
      flags: p.flags || []
    };

    return [...prev, nextItem];
  });
};

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sharbatly Weekly Promo Planner</h1>
          <p className="text-sm text-neutral-500">
            Week <span className="font-medium">{weekKey}</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className={`rounded-2xl px-4 py-2 text-sm shadow-sm border ${tab==='planner' ? 'bg-black text-white' : 'bg-white'}`}
            onClick={()=>setTab('planner')}
          >
            Planner
          </button>
          <button
            className={`rounded-2xl px-4 py-2 text-sm shadow-sm border ${tab==='results' ? 'bg-black text-white' : 'bg-white'}`}
            onClick={()=>setTab('results')}
          >
            Results
          </button>
        </div>
      </header>

      {tab==='planner' ? (
        <section overlooking className="mx-auto max-w-6xl px-4 pb-10">
          <div className="mb-4 flex items-center gap-2 justify-between">
            <div className="text-xs text-neutral-500">
              No time-gating: you can generate draft any day.
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={manualDraft}
                disabled={loading}
                className="rounded-2xl border px-4 py-2 text-sm"
              >
                {loading?'Generating…':'Generate Draft (12)'}
              </button>
              <button
                onClick={saveDraft}
                disabled={!items.length}
                className="rounded-2xl border px-4 py-2 text-sm"
              >
                Save Draft
              </button>
              <button
                onClick={exportCsv}
                className="rounded-2xl border px-4 py-2 text-sm"
              >
                Export CSV
              </button>
              <button
                onClick={publish}
                className="rounded-2xl bg-black text-white px-4 py-2 text-sm"
              >
                Publish
              </button>
              <button
                onClick={rollback}
                className="rounded-2xl border px-4 py-2 text-sm"
              >
                Rollback
              </button>
            </div>
          </div>

          {msg ? (
            <div className="rounded-xl border bg-amber-50 text-amber-800 p-3 text-sm mb-4">
              {msg}
              {csvHref && (
                <div className="mt-2">
                  <a
                    href={csvHref}
                    download={`promo-${weekKey}.csv`}
                    className="underline text-amber-900"
                  >
                    Download CSV
                  </a>
                </div>
              )}
            </div>
          ) : null}

          {/* NEW: manual control bar – remove suggested, search & add */}
          <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold mb-3">
              Manual adjustments
            </h2>
            <p className="text-xs text-neutral-500 mb-2">
              Remove any suggested item below, or search by product name / SKU to add your own picks.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={searchTerm}
                onChange={(e)=>setSearchTerm(e.target.value)}
                placeholder="Search by product name or SKU…"
                className="flex-1 rounded-md border px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={searchProducts}
                className="mt-2 sm:mt-0 rounded-2xl border px-4 py-2 text-sm bg-neutral-900 text-white disabled:opacity-60"
                disabled={searchLoading}
              >
                {searchLoading ? 'Searching…' : 'Search & Add'}
              </button>
            </div>

            {searchError && (
              <div className="mt-2 text-xs text-red-600">{searchError}</div>
            )}

            {searchResults.length > 0 && (
              <div className="mt-3 max-h-56 overflow-auto border-t pt-2 space-y-2">
                {searchResults.map((p)=>(
                  <div
                    key={p.variant_id || p.id || p.sku}
                    className="flex items-center justify-between text-sm py-1 border-b last:border-b-0"
                  >
                    <div className="pr-3">
                      <div className="font-medium">
                        {p.title || p.product_title || 'Untitled'}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {p.variant || p.variant_title} {p.sku ? `· SKU ${p.sku}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={()=>addSearchResultToDraft(p)}
                      className="text-xs px-2 py-1 border rounded-md hover:bg-green-50 hover:text-green-700"
                    >
                      Add to draft
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(items||[]).map((x, idx)=> (
              <article
                key={x.variant_id || x.sku || idx}
                className="rounded-2xl border bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold leading-tight">
                      {x.title} — {x.variant}
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {x.category?.toUpperCase?.()} · SKU {x.sku}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Chip>{x.category}</Chip>
                    {/* NEW: remove button per item */}
                    <button
                      type="button"
                      onClick={()=>removeItem(idx)}
                      className="text-[11px] text-red-600 hover:text-red-700 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  {/* Regular (editable) */}
                  <div className="rounded-xl bg-neutral-50 p-3">
                    <dt className="text-neutral-500">Regular</dt>
                    <dd className="font-semibold flex items-center gap-1">
                      <input
                        type="number"
                        step="0.05"
                        className="w-24 rounded border px-2 py-1 text-sm"
                        value={x.price === '' ? '' : (x.price ?? '')}
                        onChange={(e)=>updateItemField(idx, 'price', e.target.value)}
                      />
                      <span className="text-xs text-neutral-500">SAR</span>
                    </dd>
                  </div>

                  {/* Promo (editable) */}
                  <div className="rounded-xl bg-neutral-50 p-3">
                    <dt className="text-neutral-500">Promo</dt>
                    <dd className="font-semibold flex items-center gap-1">
                      <input
                        type="number"
                        step="0.05"
                        className="w-24 rounded border px-2 py-1 text-sm"
                        value={x.promo_price === '' ? '' : (x.promo_price ?? '')}
                        onChange={(e)=>updateItemField(idx, 'promo_price', e.target.value)}
                      />
                      <span className="text-xs text-neutral-500">SAR</span>
                    </dd>
                  </div>

                  {/* Cost (read-only) */}
                  <div className="rounded-xl bg-neutral-50 p-3">
                    <dt className="text-neutral-500">Cost</dt>
                    <dd className="font-semibold">
                      {fmt(x.cost)} <span className="text-xs text-neutral-500">SAR</span>
                    </dd>
                  </div>

                  {/* Margin @ promo (computed) */}
                  <div className="rounded-xl bg-neutral-50 p-3">
                    <dt className="text-neutral-500">Margin @ promo</dt>
                    <dd className="font-semibold">
                      {pct(x.margin_promo)}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-neutral-50 p-3">
                    <dt className="text-neutral-500">Rounded</dt>
                    <dd className="font-semibold">{x.round_rule}</dd>
                  </div>
                  <div className="rounded-xl bg-neutral-50 p-3">
                    <dt className="text-neutral-500">Flags</dt>
                    <dd className="font-semibold text-xs">
                      {(x.flags||[]).join(', ')||'-'}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <Results weeks={weeks}/>
      )}
    </div>
  )
}

function Results({weeks}){
  return (
    <section className="mx-auto max-w-6xl px-4 pb-10">
      <h2 className="text-lg font-semibold mb-3">Promo Results (auto at +7 days)</h2>
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="text-left px-4 py-3">Week</th>
              <th className="text-left px-4 py-3">Items</th>
              <th className="text-left px-4 py-3">Units</th>
              <th className="text-left px-4 py-3">Revenue</th>
              <th className="text-left px-4 py-3">Gross Margin %</th>
              <th className="text-left px-4 py-3">Markdown Cost</th>
              <th className="text-left px-4 py-3">Orders w/ Promo</th>
              <th className="text-left px-4 py-3">Retention 14d</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(weeks||[]).map((w)=> (
              <tr key={w.week} className="border-t">
                <td className="px-4 py-3 whitespace-nowrap">{w.week}</td>
                <td className="px-4 py-3">{w.items}</td>
                <td className="px-4 py-3">{(w.units||0).toLocaleString()}</td>
                <td className="px-4 py-3">{(w.revenue||0).toLocaleString()}</td>
                <td className="px-4 py-3">{(w.gm||0).toFixed(1)}%</td>
                <td className="px-4 py-3">{(w.markdown||0).toLocaleString()}</td>
                <td className="px-4 py-3">{(w.orders||0).toLocaleString()}</td>
                <td className="px-4 py-3">{(w.retention14||0).toFixed(1)}%</td>
                <td className="px-4 py-3">{w.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
