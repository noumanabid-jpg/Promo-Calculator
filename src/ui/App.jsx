import React, { useEffect, useState, useCallback } from 'react'

const fmt = (n)=>Number(n??0).toFixed(2)
const pct = (n)=>`${(Number(n??0)*100).toFixed(1)}%`

function Chip({children}){
  return <span className="rounded-full border px-2 py-1 text-[11px] text-neutral-600">{children}</span>
}

export default function App(){
  const [tab, setTab] = useState('planner')
  const [draft, setDraft] = useState({ week: '', items: [] })
  const [loading, setLoading] = useState(false)
  const [csvHref, setCsvHref] = useState('')
  const [weeks, setWeeks] = useState([])
  const [msg, setMsg] = useState('')

  const loadDraft = useCallback(async ()=>{
    const r = await fetch('/api/current-draft'); const data = await r.json(); setDraft(data||{week:'',items:[]})
  }, [])

  const manualDraft = useCallback(async ()=>{
  setLoading(true);
  try {
    const r = await fetch('/api/generate-draft-live?manual=1');
    const data = await r.json();
    setDraft(data);
  } finally {
    setLoading(false);
  }
}, []);


  const exportCsv = useCallback(async ()=>{
    const r = await fetch('/api/export-csv'); const blob = await r.blob()
    const url = URL.createObjectURL(blob); setCsvHref(url)
  }, [])

  const publish = useCallback(async ()=>{
    const r = await fetch('/api/publish', { method:'POST' }); const data = await r.json()
    setMsg(data?.ok ? 'Published with nationwide sync' : data?.error || 'Publish failed')
    loadDraft()
  }, [loadDraft])

  const rollback = useCallback(async ()=>{
    const r = await fetch('/api/rollback', { method:'POST' }); const data = await r.json()
    setMsg(data?.ok ? 'Rollback done' : data?.error || 'Rollback failed')
    loadDraft()
  }, [loadDraft])

  const loadResults = useCallback( async ()=>{
    const r = await fetch('/api/results'); const data = await r.json()
    setWeeks(data?.weeks||[])
  }, [])

  useEffect(()=>{ loadDraft(); loadResults(); }, [loadDraft, loadResults])

  const weekKey = draft.week || new Date().toISOString().slice(0,10)

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sharbatly Weekly Promo Planner</h1>
          <p className="text-sm text-neutral-500">Week <span className="font-medium">{weekKey}</span></p>
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
        <section className="mx-auto max-w-6xl px-4 pb-10">
          <div className="mb-4 flex items-center gap-2 justify-between">
            <div className="text-xs text-neutral-500">No time-gating: you can generate draft any day.</div>
            <div className="flex gap-2">
              <button onClick={manualDraft} disabled={loading} className="rounded-2xl border px-4 py-2 text-sm">{loading?'Generating…':'Generate Draft (12)'}</button>
              <button onClick={exportCsv} className="rounded-2xl border px-4 py-2 text-sm">Export CSV</button>
              <button onClick={publish} className="rounded-2xl bg-black text-white px-4 py-2 text-sm">Publish</button>
              <button onClick={rollback} className="rounded-2xl border px-4 py-2 text-sm">Rollback</button>
            </div>
          </div>
          {msg ? <div className="rounded-xl border bg-amber-50 text-amber-800 p-3 text-sm mb-4">{msg}</div> : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(draft.items||[]).map((x)=> (
              <article key={x.variant_id} className="rounded-2xl border bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold leading-tight">{x.title} — {x.variant}</h3>
                    <p className="text-xs text-neutral-500 mt-0.5">{x.category?.toUpperCase?.()} · SKU {x.sku}</p>
                  </div>
                  <Chip>{x.category}</Chip>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-neutral-500">Regular</dt><dd className="font-semibold">{fmt(x.price)} <span className="text-xs text-neutral-500">SAR</span></dd></div>
                  <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-neutral-500">Promo</dt><dd className="font-semibold">{fmt(x.promo_price)} <span className="text-xs text-neutral-500">SAR</span></dd></div>
                  <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-neutral-500">Cost</dt><dd className="font-semibold">{fmt(x.cost)} <span className="text-xs text-neutral-500">SAR</span></dd></div>
                  <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-neutral-500">Margin @ promo</dt><dd className="font-semibold">{pct(x.margin_promo)}</dd></div>
                  <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-neutral-500">Rounded</dt><dd className="font-semibold">{x.round_rule}</dd></div>
                  <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-neutral-500">Flags</dt><dd className="font-semibold text-xs">{(x.flags||[]).join(', ')||'-'}</dd></div>
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
