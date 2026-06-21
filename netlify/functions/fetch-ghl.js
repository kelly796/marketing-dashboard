/**
 * Fetch Go High Level Data — multi-pipeline version
 *
 * Returns all pipelines with per-stage lead counts, stall detection,
 * lead source breakdown, and unassigned inbox.
 *
 * Stall thresholds (days since last update):
 *   < 3 days  → green (active)
 *   3–7 days  → amber (stalled)
 *   7+ days   → red (critical)
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────
 *  GHL_API_KEY        — Private Integration Token (pit-xxxx)
 *  GHL_LOCATION_ID    — Sub-account / location ID
 */

const GHL_BASE   = 'https://services.leadconnectorhq.com';
const AMBER_DAYS = 3;
const RED_DAYS   = 7;

exports.handler = async () => {
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeholder:  true,
        pipelines:    [],
        unassigned:   { count: 0, leads: [] },
        summary:      { totalLeads: 0, stalledLeads: 0, unassignedLeads: 0 },
        recentContacts: [],
        pipeline:     { totalContacts: null, totalValue: null, stages: {} },
        message:      'Add GHL_API_KEY and GHL_LOCATION_ID to Netlify env vars to enable live data.',
      }),
    };
  }

  const headers = {
    Authorization:  `Bearer ${apiKey}`,
    Version:        '2021-07-28',
    'Content-Type': 'application/json',
  };

  try {
    // ── Fetch all pipelines ─────────────────────────────────────────
    const pipelinesRes  = await fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${locationId}`, { headers });
    const pipelinesData = await pipelinesRes.json();
    const allPipelines  = pipelinesData.pipelines || [];

    // ── Fetch opportunities for each pipeline in parallel ───────────
    const oppsResults = await Promise.allSettled(
      allPipelines.map(pipe =>
        fetch(`${GHL_BASE}/opportunities/search?location_id=${locationId}&pipeline_id=${pipe.id}&limit=100`, { headers })
          .then(r => r.json())
      )
    );

    const now = Date.now();

    const pipelines = allPipelines.map((pipe, idx) => {
      const oppsData = oppsResults[idx].status === 'fulfilled' ? oppsResults[idx].value : {};
      const opps = (oppsData.opportunities || []).filter(o => !o.name.startsWith('(Example)'));

      // Build stage buckets
      const stageBuckets = {};
      (pipe.stages || []).forEach(s => { stageBuckets[s.id] = []; });

      // Assign open opps to their stage
      opps
        .filter(o => o.status !== 'won' && o.status !== 'lost')
        .forEach(o => {
          const daysSinceUpdate = Math.floor(
            (now - new Date(o.updatedAt || o.createdAt).getTime()) / 86400000
          );
          const lead = {
            id:              o.id,
            name:            o.name,
            source:          o.source || 'Unknown',
            email:           o.contact?.email || '',
            phone:           o.contact?.phone || '',
            daysSinceUpdate,
            stalled:         daysSinceUpdate >= AMBER_DAYS,
            critical:        daysSinceUpdate >= RED_DAYS,
            addedAt:         o.createdAt,
            updatedAt:       o.updatedAt || o.createdAt,
          };
          if (stageBuckets[o.pipelineStageId] !== undefined) {
            stageBuckets[o.pipelineStageId].push(lead);
          }
        });

      const stages = (pipe.stages || []).map(s => {
        const leads = stageBuckets[s.id] || [];
        return {
          id:            s.id,
          name:          s.name,
          position:      s.position,
          count:         leads.length,
          stalledCount:  leads.filter(l => l.stalled && !l.critical).length,
          criticalCount: leads.filter(l => l.critical).length,
          leads,
        };
      });

      return {
        id:            pipe.id,
        name:          pipe.name,
        isUnassigned:  pipe.name.toLowerCase().includes('unassigned'),
        totalLeads:    stages.reduce((n, s) => n + s.count, 0),
        stalledLeads:  stages.reduce((n, s) => n + s.stalledCount + s.criticalCount, 0),
        criticalLeads: stages.reduce((n, s) => n + s.criticalCount, 0),
        stages,
      };
    });

    // ── Separate unassigned pipeline ────────────────────────────────
    const unassignedPipeline = pipelines.find(p => p.isUnassigned);
    const mainPipelines      = pipelines.filter(p => !p.isUnassigned);
    const unassignedLeads    = unassignedPipeline
      ? unassignedPipeline.stages.flatMap(s => s.leads)
      : [];

    const summary = {
      totalLeads:      mainPipelines.reduce((n, p) => n + p.totalLeads, 0),
      stalledLeads:    mainPipelines.reduce((n, p) => n + p.stalledLeads, 0),
      unassignedLeads: unassignedLeads.length,
    };

    // ── Recent contacts (last 10) for overview backwards compat ─────
    const recentContacts = mainPipelines
      .flatMap(p => p.stages.flatMap(s => s.leads.map(l => ({
        ...l,
        stage:    s.name,
        pipeline: p.name,
      }))))
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
      .slice(0, 10);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeholder:    false,
        pipelines:      mainPipelines,
        unassigned:     { count: unassignedLeads.length, leads: unassignedLeads },
        summary,
        recentContacts,
        pipeline: {
          totalContacts: summary.totalLeads,
          totalValue:    null,
          stages:        {},
        },
      }),
    };

  } catch (err) {
    console.error('fetch-ghl error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, placeholder: true }),
    };
  }
};
