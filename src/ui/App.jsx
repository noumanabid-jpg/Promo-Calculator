import React, { useEffect, useState, useCallback } from 'react'

const fmt = (n)=>Number(n??0).toFixed(2)
const pct = (n)=>`${(Number(n??0)*100).toFixed(1)}%`

function Chip({children}){
  return <span className="rounded-full border px-2 py-1 text-[11px] text-neutral-600">{children}</span>
}

export default function App(){
  const [tab, setTab] = useState('planner')
  const [draft, setDraft] = useState({ week: '', items: [] })
  const [items, setItems] = useState([])          // editable items in planner
  const [loading, setLoading] = useState(false)
  const [csvHref, setCsvHref] = useState('')
  const [weeks, setWeeks] = useState([])
  const [msg, setMsg] = useState('')

  // search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')

  // campaigns tab state
  const [campaigns, setCampaigns] = useState([])
  const [campaignLoading, setCampaignLoading] = useState(false)

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

  // Client-side CSV export based on current planner items
  const exportCsv = useCallback(() => {
    if (!items.length) {
      setMsg('No items to export')
      return
    }

    const esc = (v) => {
      const s = v === undefined || v === null ? '' : String(v)
      return `"${s.replace(/"/g, '""')}"`
    }

    const header = [
      'Title',
      'Variant',
      'SKU',
      'Category',
      'Price',
      'Promo Price',
      'Cost',
      'Margin Promo (%)',
      'Rounded',
      'Flags'
    ]

    const rows = items.map(x => {
      const price        = x.price ?? ''
      const promoPrice   = x.promo_price ?? ''
      const cost         = x.cost ?? ''
      const marginPct    = x.margin_promo != null
        ? (Number(x.margin_promo) * 100).toFixed(1)
        : ''
      const flags        = (x.flags || []).join(', ')

      return [
        esc(x.title),
        esc(x.variant),
        esc(x.sku),
        esc(x.category),
        esc(price),
        esc(promoPrice),
        esc(cost),
        esc(marginPct),
        esc(x.round_rule || ''),
        esc(flags)
      ].join(',')
    })

    const csvContent = [header.join(','), ...rows].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)

    setCsvHref(url)
    setMsg('CSV ready — click the download link below.')
  }, [items])

  // Publish: send current planner items to /api/publish
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

  // Rollback: scoped to products in current planner
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

  // Load campaigns list (for Campaigns tab)
  const loadCampaigns = useCallback(async ()=>{
    setCampaignLoading(true)
    try {
      const r = await fetch('/api/campaigns')
      const data = await r.json()
      setCampaigns(data?.campaigns || [])
    } catch (e) {
      console.error('campaigns error', e)
      setCampaigns([])
    } finally {
      setCampaignLoading(false)
    }
  }, [])

  useEffect(()=>{ 
    loadDraft(); 
    loadResults(); 
  }, [loadDraft, loadResults])

  useEffect(() => {
    if (tab === 'campaigns') {
      loadCampaigns()
    }
  }, [tab, loadCampaigns])

  // Update a field (price / promo_price) & recalc margin_promo
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

  // --- Search: call /api/products-search and allow adding to draft ---

  const runSearch = useCallback(async ()=>{
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults([])
      setSearchError('')
      return
    }

    setSearchLoading(true)
    setSearchError('')
    try {
      const r = await fetch(`/api/products-search?q=${encodeURIComponent(q)}`)
      if (!r.ok) {
        throw new Error('Search failed')
      }
      const data = await r.json()
      setSearchResults(data?.items || [])
      if (!data?.items?.length) {
        setSearchError('No products found for this query')
      }
    } catch (e) {
      console.error('products-search error', e)
      setSearchError('Could not fetch products')
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }, [searchQuery])

  // Add a searched product into planner, enriched with cost from Shopify
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
          <button
            className={`rounded-2xl px-4 py-2 text-sm shadow-sm border ${tab==='campaigns' ? 'bg-black text-white' : 'bg-white'}`}
            onClick={()=>setTab('campaigns')}
          >
            Campaigns
          </button>
        </div>
      </header>

      {tab==='planner' ? (
        <section className="mx-auto max-w-6xl px-4 pb-10">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-neutral-500">
              No time-gating: you can generate, tweak, and publish the draft any day.
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

          {/* Search panel */}
          <div className="mb-4 rounded-2xl border bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div className="flex-1">
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  Add items manually by search (title / SKU)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e)=>setSearchQuery(e.target.value)}
                    onKeyDown={(e)=>{ if(e.key === 'Enter'){ runSearch() } }}
                    className="flex-1 rounded-xl border px-3 py-2 text-sm"
                    placeholder="Search by product name or SKU…"
                  />
                  <button
                    type="button"
                    onClick={runSearch}
                    disabled={searchLoading}
                    className="rounded-xl border px-3 py-2 text-sm min-w-[100px]"
                  >
                    {searchLoading ? 'Searching…' : 'Search'}
                  </button>
                </div>
                {searchError && (
                  <p className="mt-1 text-xs text-red-600">{searchError}</p>
                )}
              </div>
            </div>

            {searchResults.length > 0 && (
              <div className="mt-3 max-h-64 overflow-y-auto border-t pt-3">
                <p className="text-xs text-neutral-500 mb-2">
                  Click “Add” to include a variant in this week’s promo draft. Cost will be pulled from Shopify.
                </p>
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="text-left px-2 py-1">Title</th>
                      <th className="text-left px-2 py-1">Variant</th>
                      <th className="text-left px-2 py-1">SKU</th>
                      <th className="text-left px-2 py-1">Price</th>
                      <th className="text-left px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((p, idx)=>(
                      <tr key={p.variant_id || p.id || idx} className="border-t">
                        <td className="px-2 py-1">{p.title}</td>
                        <td className="px-2 py-1">{p.variant}</td>
                        <td className="px-2 py-1">{p.sku}</td>
                        <td className="px-2 py-1">{fmt(p.price)}</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            onClick={()=>addSearchResultToDraft(p)}
                            className="rounded-full border px-3 py-1 text-[11px] hover:bg-neutral-100"
                          >
                            Add
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Planner cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(items||[]).map((x, idx)=> (
              <article key={x.variant_id || x.sku || idx} className="rounded-2xl border bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <div className="flex items-start justify-between gap-3">
  <div>
    <h3 className="font-semibold leading-tight">{x.title} — {x.variant}</h3>
    <p className="text-xs text-neutral-500 mt-0.5">
      {x.category?.toUpperCase?.()} · SKU {x.sku}
    </p>
  </div>
  <div className="flex flex-col items-end gap-2">
    <Chip>{x.category}</Chip>
    <button
      type="button"
      onClick={() =>
        setItems(prev => prev.filter((_, i) => i !== idx))
      }
      className="rounded-full border px-2 py-1 text-[11px] text-neutral-600 hover:bg-red-50 hover:text-red-700"
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
                    <dd className="font-semibold text-xs">{(x.flags||[]).join(', ')||'-'}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ) : tab==='results' ? (
        <Results weeks={weeks}/>
      ) : (
        <CampaignsView
          campaigns={campaigns}
          loading={campaignLoading}
          onRollback={async (id) => {
            try {
              const r = await fetch(`/api/rollback-campaign?id=${encodeURIComponent(id)}`, {
                method: 'POST'
              })
              const data = await r.json()
              setMsg(
                data?.ok
                  ? `Rollback done for campaign ${id} (restored ${data.restored || 0} variants)`
                  : data?.error || 'Rollback failed for campaign'
              )
              loadCampaigns()
            } catch (e) {
              console.error('rollback-campaign error', e)
              setMsg('Rollback failed for campaign')
            }
          }}
        />
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

function CampaignsView({campaigns, loading, onRollback}) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-10">
      <h2 className="text-lg font-semibold mb-3">Published Campaigns</h2>
      <p className="text-xs text-neutral-500 mb-4">
        Each row represents a publish event. Rollback is scoped to products that were part of that publish,
        restoring their prices from compare-at pricing.
      </p>

      {loading ? (
        <div className="text-sm text-neutral-500">Loading campaigns…</div>
      ) : !campaigns.length ? (
        <div className="text-sm text-neutral-500">No campaigns recorded yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-600">
              <tr>
                <th className="text-left px-4 py-3">Created</th>
                <th className="text-left px-4 py-3">Week</th>
                <th className="text-left px-4 py-3">Products</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {c.created_at || c.id}
                  </td>
                  <td className="px-4 py-3">{c.week || '-'}</td>
                  <td className="px-4 py-3">{c.product_count ?? (c.product_ids?.length || 0)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onRollback(c.id)}
                      className="rounded-full border px-3 py-1 text-xs hover:bg-red-50 hover:text-red-700"
                    >
                      Rollback this campaign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
