import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;

const supabaseSecret =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(
  supabaseUrl,
  supabaseSecret,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);

const allowedCounties = new Set([
  'Los Angeles',
  'Orange',
  'Riverside',
  'San Bernardino',
  'San Diego',
  'San Luis Obispo',
  'Santa Barbara',
  'Ventura',
  'Other Southern California'
]);

const allowedOrgSizes = new Set([
  '1-10',
  '11-25',
  '26-50',
  '51-100',
  '101-250',
  '251-500',
  '501+'
]);

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  try {

    const {
      job_family,
      standardized_title,
      county,
      annual_salary,
      tenure_years,
      org_size
    } = req.body || {};

    const jobFamily = String(job_family || '').trim();
    const standardizedTitle = String(standardized_title || '').trim();
    const countyValue = String(county || '').trim();

    const salary = Number(annual_salary);

    const tenure =
      tenure_years === '' ||
      tenure_years === null ||
      tenure_years === undefined
        ? null
        : Number(tenure_years);

    const orgSize =
      org_size === '' ||
      org_size === null ||
      org_size === undefined
        ? null
        : String(org_size).trim();

    // Required fields
    if (!jobFamily) {
      return res.status(400).json({
        ok: false,
        error: 'Job family is required.'
      });
    }

    if (!standardizedTitle) {
      return res.status(400).json({
        ok: false,
        error: 'Standardized job title is required.'
      });
    }

    if (!allowedCounties.has(countyValue)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid county.'
      });
    }

    // Salary validation
    if (
      !Number.isFinite(salary) ||
      salary < 15000 ||
      salary > 1000000
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Salary is outside the accepted range.'
      });
    }

    // Tenure validation
    if (
      tenure !== null &&
      (
        !Number.isFinite(tenure) ||
        tenure < 0 ||
        tenure > 60
      )
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Tenure is invalid.'
      });
    }

    if (
      orgSize !== null &&
      !allowedOrgSizes.has(orgSize)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Organization size is invalid.'
      });
    }

    const { data, error } = await supabase
      .from('salary_submissions')
      .insert({
        job_family: jobFamily,
        standardized_title: standardizedTitle,
        county: countyValue,
        annual_salary: salary,

        tenure_years: tenure,
        org_size: orgSize,

        validation_status: 'pending',
        included_in_live_benchmark: false,
        source: 'salary_calculator'
      })
      .select('id, created_at')
      .single();

    if (error) {
      console.error('Supabase insert error:', error);

      return res.status(500).json({
        ok: false,
        error: 'Unable to save salary submission.'
      });
    }

    return res.status(200).json({
      ok: true,
      submission_id: data.id
    });

  } catch (error) {

    console.error('Salary submission error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unexpected server error.'
    });
  }
}
