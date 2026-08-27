import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseSecret, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const MIN_PUBLIC_SAMPLE = 5;
const PAGE_SIZE = 1000;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function statsFor(rows) {
  const salaries = rows
    .map(r => Number(r.annual_salary))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!salaries.length) return null;
  return {
    n: salaries.length,
    p25: Math.round(percentile(salaries, 0.25)),
    median: Math.round(percentile(salaries, 0.50)),
    p75: Math.round(percentile(salaries, 0.75)),
    min: Math.round(salaries[0]),
    max: Math.round(salaries[salaries.length - 1])
  };
}

function groupRows(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    if (!supabaseUrl || !supabaseSecret) {
      return res.status(500).json({ ok: false, error: 'Server configuration is incomplete.' });
    }

    const approved = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('salary_submissions')
        .select('job_family, standardized_title, county, annual_salary, created_at')
        .eq('validation_status', 'accepted')
        .eq('included_in_live_benchmark', true)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('Live salary stats query error:', error);
        return res.status(500).json({ ok: false, error: 'Unable to load live salary statistics.' });
      }

      approved.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const overall = statsFor(approved);
    const titles = new Set(approved.map(r => r.standardized_title).filter(Boolean));
    const families = new Set(approved.map(r => r.job_family).filter(Boolean));
    const counties = new Set(approved.map(r => r.county).filter(Boolean));

    const byTitle = groupRows(approved, r => r.standardized_title || null);
    const titleGroups = Array.from(byTitle.entries())
      .map(([title, rows]) => {
        const s = statsFor(rows);
        if (!s || s.n < MIN_PUBLIC_SAMPLE) return null;
        return {
          title,
          job_family: rows[0]?.job_family || '',
          ...s
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.n - a.n || a.title.localeCompare(b.title));

    const byFamily = groupRows(approved, r => r.job_family || null);
    const familyGroups = Array.from(byFamily.entries())
      .map(([job_family, rows]) => {
        const s = statsFor(rows);
        if (!s || s.n < MIN_PUBLIC_SAMPLE) return null;
        return { job_family, ...s };
      })
      .filter(Boolean)
      .sort((a, b) => b.n - a.n || a.job_family.localeCompare(b.job_family));

    const payload = {
      ok: true,
      min_public_sample: MIN_PUBLIC_SAMPLE,
      approved_submissions: approved.length,
      represented_titles: titles.size,
      represented_families: families.size,
      represented_counties: counties.size,
      overall: overall && overall.n >= MIN_PUBLIC_SAMPLE ? overall : null,
      title_groups: titleGroups,
      family_groups: familyGroups,
      last_approved_submission_at: approved.length ? approved[approved.length - 1].created_at : null,
      generated_at: new Date().toISOString()
    };

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Live salary stats error:', error);
    return res.status(500).json({ ok: false, error: 'Unexpected server error.' });
  }
}
