export const inr = (n) =>
  Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 'YYYY-MM-DD' -> 'DD-MM-YYYY'
export const dmy = (s) => (s ? String(s).split('-').reverse().join('-') : '');

// 'YYYY-MM' or 'YYYY-MM-DD' -> 'October 2026'
export const monthLabel = (ym) =>
  new Date(`${String(ym).slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });

// A balance: negative means the doctor has paid in advance (credit)
export const inrBal = (n) => (Number(n) < 0 ? `${inr(Math.abs(Number(n)))} Cr` : inr(n));
