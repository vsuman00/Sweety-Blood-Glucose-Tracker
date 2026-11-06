export const TIMEZONE = 'Asia/Kolkata';
export const slots = ['morning_fasting', 'after_breakfast', 'after_lunch', 'after_dinner'];
export function today(now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-CA', {timeZone: TIMEZONE, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const get = type => parts.find(p => p.type === type).value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validDate(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
 const date = new Date(`${value}T00:00:00Z`);
 return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === value;
}
export function ranges(date) {
 const [year, month] = date.split('-').map(Number);
 const iso = d => d.toISOString().slice(0,10);
 return {
  daily: [date, iso(new Date(Date.UTC(year, month - 1, Number(date.slice(8)) + 1)))],
  monthToDate: [`${date.slice(0,7)}-01`, iso(new Date(Date.UTC(year, month - 1, Number(date.slice(8)) + 1)))],
  previousMonth: [iso(new Date(Date.UTC(year, month - 2, 1))), `${date.slice(0,7)}-01`]
 };
}
