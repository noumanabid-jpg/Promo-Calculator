export function roundPsych(n){
  const f = Math.floor(n);
  const c1 = f + 0.50;
  const c2 = f + 0.95;
  const c3 = f + 1.50;
  const ups = [c1,c2,c3].filter(x=>x>=n);
  return ups.length ? Math.min(...ups) : Math.max(c1,c2,c3);
}
export function applyGuardrails({price, cost}){
  if(price<=0 || cost<=0 || cost>=price) return { ok:false, reason:'no-margin', promo:null };
  const minMargin = 0.03;
  let promo = Math.max(cost/(1-minMargin), 0.01);
  promo = roundPsych(promo);
  let tries=0;
  while(((promo - cost)/promo) < minMargin && tries<8){
    promo = roundPsych(promo+0.01);
    tries++;
  }
  if(((promo - cost)/promo) < minMargin) return { ok:false, reason:'floor-failed', promo:null };
  return { ok:true, promo };
}
export function normalize(x, min, max){
  if(max<=min) return 0;
  const v=(x-min)/(max-min);
  return Math.max(0, Math.min(1, v));
}
export function scoreVariant(v){
  return Math.round((0.35*v.stockPressureNorm + 0.25*v.marginHeadroomNorm + 0.20*(v.heroBoost||0) + 0.20*v.velocityNorm) * 100);
}
