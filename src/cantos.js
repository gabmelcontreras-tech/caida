import { VALUE_ORDER } from "./cards.js";

const ORDER = VALUE_ORDER; // [1,2,3,4,5,6,7,10,11,12]

function idx(v) { return ORDER.indexOf(v); }
const rank = (v) => ORDER.indexOf(v);

function isConsecutive3(values) {
  const sorted = values.slice().sort((a,b) => idx(a) - idx(b));
  if (sorted.some(v => idx(v) === -1)) return false;
  return idx(sorted[1]) === idx(sorted[0]) + 1 && idx(sorted[2]) === idx(sorted[1]) + 1;
}

function pointsForRonda(pairValue) {
  if (pairValue >= 1 && pairValue <= 7) return 1;
  if (pairValue === 10) return 2;
  if (pairValue === 11) return 3;
  if (pairValue === 12) return 4;
  return 0;
}

export function bestCanto(hand3) {
  if (!hand3 || hand3.length !== 3) return null;

  const values = hand3.map(c => c.value);
  const [a,b,c] = values;

  // Registro: {11,12,1}
  const set = new Set(values);
  if (set.size === 3 && set.has(11) && set.has(12) && set.has(1)) {
    return { type: "REGISTRO", points: 8 };
  }

  // Counts
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);

  // Trivilín: three equal
  if (counts.size === 1) {
    return { type: "TRIVILIN", points: 5, value: a };
  }

  // Vigía: pair + adjacent (prev/next in Caída order)
  // Find pair value
  let pairValue = null;
  let kicker = null;
  for (const [v, ct] of counts.entries()) {
    if (ct === 2) pairValue = v;
    if (ct === 1) kicker = v;
  }
  if (pairValue !== null && kicker !== null) {
    const p = idx(pairValue);
    const k = idx(kicker);
    const adjacent = (k === p - 1) || (k === p + 1);
    if (adjacent) {
      return { type: "VIGIA", points: 7, value: pairValue, kicker };
    }
  }

  // Patrulla: 3 consecutive
  if (set.size === 3 && isConsecutive3(values)) {
    const sorted = values.slice().sort((x,y) => idx(x) - idx(y));
    return { type: "PATRULLA", points: 6, values: sorted };
  }

  // Ronda: pair + kicker
  if (pairValue !== null) {
    return { type: "RONDA", points: pointsForRonda(pairValue), value: pairValue, kicker };
  }

  return null;
}

export function cantoStrength(canto) {
  if (!canto) return -1;

  switch (canto.type) {
    case "REGISTRO":
      // Only one possible set, both equal strength
      return 0;

    case "TRIVILIN":
      // three of a kind value decides
      return rank(canto.value);

    case "PATRULLA":
      // compare highest value in the sequence
      // canto.values is sorted in Caída order
      return rank(canto.values[2]);

    case "RONDA":
    case "VIGIA":
      // compare the paired value
      // If pair ties, use kicker to break ties
      return rank(canto.value) * 100 + (rank(canto.kicker) >= 0 ? rank(canto.kicker) : 0);

    default:
      return -1;
  }
}

export function cantoPriority(type) {
  // Higher number wins
  switch (type) {
    case "REGISTRO": return 5;
    case "VIGIA": return 4;
    case "PATRULLA": return 3;
    case "TRIVILIN": return 2;
    case "RONDA": return 1;
    default: return 0;
  }
}
