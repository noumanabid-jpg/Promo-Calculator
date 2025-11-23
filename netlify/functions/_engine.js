// netlify/functions/_engine.js
// Scoring + guardrails helpers

import { money } from './_shopify.js';

/**
 * Normalize value into [0,1] given min/max.
 */
export function normalize(value, min, max) {
  const v = Number(value || 0);
  const lo = Number(min || 0);
  const hi = Number(max || 0);
  if (hi <= lo) return 0.5;
  const x = (v - lo) / (hi - lo);
  return Math.max(0, Math.min(1, x));
}

/**
 * Compute score for a variant using normalized fields:
 * - stockPressureNorm
 * - marginHeadroomNorm
 * - velocityNorm
 * - heroBoost (0 or 1)
 */
export function scoreVariant(v) {
  const stock = Number(v.stockPressureNorm || 0);
  const margin = Number(v.marginHeadroomNorm || 0);
  const vel = Number(v.velocityNorm || 0);
  const hero = Number(v.heroBoost || 0);

  // weights can be tuned later
  return (
    0.35 * stock +
    0.25 * margin +
    0.20 * vel +
    0.20 * hero
  );
}

/**
 * Guardrails:
 * - Try to discount ~20% by default.
 * - Enforce margin >= 3%.
 * - Round to *.50 or *.95.
 */
export function applyGuardrails({ price, cost }) {
  const p = money(price);
  const c = money(cost);

  if (!p || p <= 0) {
    return { ok: false, reason: "no-price" };
  }

  // target ~20% off as baseline
  let candidate = p * 0.8;

  // ensure > 0
  if (candidate <= 0) {
    return { ok: false, reason: "candidate<=0" };
  }

  // round to psychological price: *.50 / *.95
  const rounded = roundPsych(candidate);

  if (rounded <= 0) {
    return { ok: false, reason: "rounded<=0" };
  }

  // enforce margin >= 3%
  const margin = (rounded - c) / rounded;
  if (margin < 0.03) {
    // bump up to just above 3% margin and round again
    const minPrice = c / (1 - 0.03); // price s.t. margin=3%
    const bumped = roundPsych(minPrice);
    if (bumped <= 0) {
      return { ok: false, reason: "bumped<=0" };
    }
    const margin2 = (bumped - c) / bumped;
    if (margin2 < 0.03) {
      return { ok: false, reason: "cannot-hit-margin" };
    }
    return { ok: true, promo: bumped };
  }

  return { ok: true, promo: rounded };
}

/**
 * Round to *.50 or *.95 for psychological pricing.
 */
function roundPsych(value) {
  const v = money(value);
  if (v <= 0) return 0;
  const whole = Math.floor(v);
  const decimals = v - whole;

  let candidate;
  if (decimals <= 0.5) {
    candidate = whole + 0.5;
  } else {
    candidate = whole + 0.95;
  }

  // If candidate < v slightly, nudge up a step
  if (candidate < v) {
    return candidate + 0.5; // crude but fine for now
  }
  return candidate;
}
