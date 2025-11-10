# Sharbatly Weekly Promo Planner — MVP v2

Adds:
- Orders analytics (last 8 weeks): uplift-ready KPIs (units, revenue, GM%, markdown, orders containing promo items, retention placeholder)
- Nationwide sync on Publish: all variants of a product get the same promo price
- Fatigue control: avoid repeating exact SKUs >2 consecutive weeks
- Hero learning: auto-tag top quartile performers as `custom.hero = true`

## ENV (Netlify)
SHOPIFY_STORE, SHOPIFY_ADMIN_ACCESS_TOKEN, COST_METAFIELD_NAMESPACE=custom, COST_METAFIELD_KEY=cost_sar, DO_NOT_DISCOUNT_TAG=do_not_discount, SUGGESTION_TOPN_FRUIT=6, SUGGESTION_TOPN_VEG=6

## Endpoints
GET /api/generate-draft?manual=1
GET /api/current-draft
POST /api/publish
POST /api/rollback
GET /api/export-csv
GET /api/results
Scheduled: Tuesday draft, daily measurement

> Note: Results KPIs compute from last 8 weeks orders as a proxy; for precise uplift & retention, filter by exact publish window and post-window periods in scheduled job.
