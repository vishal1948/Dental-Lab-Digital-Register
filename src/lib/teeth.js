import { HttpError } from '../middleware/errors.js';

export const QUADRANTS = ['UR', 'UL', 'LR', 'LL']; // Upper Right, Upper Left, Lower Right, Lower Left

// Accepts {"UR":[1,2],"LL":[8]}; returns a cleaned copy (sorted, de-duplicated, empty quadrants dropped)
export function cleanTeeth(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Teeth selection is invalid');
  }
  const out = {};
  for (const [quadrant, list] of Object.entries(input)) {
    if (!QUADRANTS.includes(quadrant) || !Array.isArray(list)) {
      throw new HttpError(400, 'Teeth selection is invalid');
    }
    const nums = [...new Set(list.map(Number))];
    if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 8)) {
      throw new HttpError(400, 'Tooth numbers must be between 1 and 8');
    }
    if (nums.length) out[quadrant] = nums.sort((a, b) => a - b);
  }
  return out;
}

export const countTeeth = (teeth) =>
  Object.values(teeth).reduce((n, list) => n + list.length, 0);

// Palmer-style digits for printing: right side reads outward->centre (8..1), left side centre->outward (1..8)
export const palmerDigits = (teeth = {}) => {
  const d = (q, desc) =>
    (teeth[q] ?? []).slice().sort((a, b) => (desc ? b - a : a - b)).join('');
  return { UR: d('UR', true), UL: d('UL', false), LR: d('LR', true), LL: d('LL', false) };
};
