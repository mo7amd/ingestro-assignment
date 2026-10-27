// Ingestro case study data generator.
// Usage: node generate-data.mjs [rows=200000] [seed=42] [--report]
// Writes import-data.csv. With --report it also writes issues-report.json (answer key, do not read it before you build).
import { writeFileSync, createWriteStream } from 'node:fs';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const nums = args.filter((a) => !a.startsWith('--'));
const ROWS = Number(nums[0] ?? 200000);
const SEED = Number(nums[1] ?? 42);
const WITH_REPORT = flags.includes('--report');

// Small deterministic PRNG (mulberry32), so everybody gets the same file for the same seed.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const int = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const pad = (n) => String(n).padStart(2, '0');

const FIRST = ['Anna', 'Luca', 'Mia', 'Noah', 'Emma', 'Leon', 'Sofia', 'Jonas', 'Lena', 'Mateo', 'Chloe', 'Omar', 'Yuki', 'Priya', 'Ahmed', 'Elena', 'Tomas', 'Ines', 'Karim', 'Hana'];
const LAST = ['Müller', 'Schmidt', 'Rossi', 'García', 'Dubois', 'Novak', 'Kowalski', "O'Brien", 'Silva', 'Tanaka', 'Khan', 'Haddad', 'Jensen', 'Costa', 'Weber', 'Smith, Jr.', 'Nguyen', 'Petrov', 'Lindqvist', 'Moreau'];
const COUNTRIES = {
  DE: ['DE', 'Germany', 'Deutschland', 'germany ', 'de'],
  FR: ['FR', 'France', 'fr', 'FRANCE'],
  IT: ['IT', 'Italy', 'Italia', 'it'],
  ES: ['ES', 'Spain', 'España', 'es'],
  NL: ['NL', 'Netherlands', 'Nederland', 'The Netherlands'],
  PL: ['PL', 'Poland', 'Polska', 'pl'],
  GB: ['GB', 'United Kingdom', 'UK', 'gb'],
  US: ['US', 'United States', 'USA', 'U.S.'],
};
const COUNTRY_CODES = Object.keys(COUNTRIES);
const PLANS = ['free', 'pro', 'enterprise'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const report = { rows: ROWS, seed: SEED, counts: {} };
const bump = (k) => { report.counts[k] = (report.counts[k] ?? 0) + 1; };

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function makeDate() {
  const y = int(2019, 2025), m = int(1, 12), d = int(1, 28);
  const roll = rnd();
  if (roll < 0.9) return `${y}-${pad(m)}-${pad(d)}`;                       // clean ISO
  if (roll < 0.94) { bump('date_ambiguous_slash'); return `${pad(d)}/${pad(m)}/${y}`; } // 03/04/2024 is ambiguous on purpose
  if (roll < 0.97) { bump('date_text_month'); return `${d} ${MONTHS[m - 1]} ${y}`; }
  if (roll < 0.985) { bump('date_impossible'); return `${y}-02-30`; }
  bump('date_missing'); return '';
}

const rows = [];
const emailPool = [];
for (let i = 1; i <= ROWS; i++) {
  let first = pick(FIRST), last = pick(LAST);
  let email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + i + '@' + pick(['example.com', 'mail.test', 'corp.example']);
  let country = pick(COUNTRY_CODES);
  let countryValue = chance(0.55) ? COUNTRIES[country][0] : pick(COUNTRIES[country]);
  if (countryValue !== COUNTRIES[country][0]) bump('country_variant');
  let plan = pick(PLANS);
  let spend = plan === 'free' ? 0 : plan === 'pro' ? int(19, 199) : int(500, 9000);
  let spendValue = String(spend);

  if (chance(0.012)) { bump('email_invalid'); email = pick([email.replace('@', ''), email.replace('.com', ''), email.replace('@', '@@'), email.split('@')[0] + '@']); }
  if (chance(0.01)) { bump('email_missing'); email = ''; }
  if (chance(0.015)) { bump('name_whitespace'); first = ` ${first}  `; }
  if (chance(0.008)) { bump('name_missing'); last = ''; }
  if (chance(0.01)) { bump('plan_casing_or_typo'); plan = pick([plan.toUpperCase(), ` ${plan}`, plan === 'enterprise' ? 'enterprize' : plan + 's']); }
  if (chance(0.02)) { bump('spend_text_format'); spendValue = pick([`€ ${spend}`, spend.toLocaleString('en-US') + '.50', `${spend},50`, `${spend} EUR`]); }
  if (chance(0.004)) { bump('spend_not_a_number'); spendValue = pick(['n/a', 'TBD', '??']); }
  if (chance(0.003)) { bump('spend_negative'); spendValue = String(-spend - 1); }
  if (chance(0.005)) { bump('country_missing'); countryValue = ''; }

  const id = `C-${String(i).padStart(7, '0')}`;
  rows.push([id, first, last, email, makeDate(), countryValue, plan, spendValue]);
  if (email.includes('@') && !email.includes('@@')) emailPool.push(rows.length - 1);
}

// Duplicates: about 1.5% of rows get the same email as another row.
const dupCount = Math.floor(ROWS * 0.015);
for (let k = 0; k < dupCount; k++) {
  const src = rows[emailPool[int(0, emailPool.length - 1)]];
  const target = rows[int(0, rows.length - 1)];
  if (src === target) continue;
  target[3] = src[3];
  bump('email_duplicate');
}

const out = createWriteStream('import-data.csv');
out.write('customer_id,first_name,last_name,email,signup_date,country,plan,monthly_spend\n');
for (const r of rows) out.write(r.map(csvCell).join(',') + '\n');
out.end(() => console.log(`Wrote import-data.csv with ${ROWS} rows (seed ${SEED}).`));

if (WITH_REPORT) {
  writeFileSync('issues-report.json', JSON.stringify(report, null, 2));
  console.log('Wrote issues-report.json (answer key).');
}