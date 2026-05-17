exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
    };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');

    // Recent campaigns (up to 5)
    const recentCampaigns = (email?.overall?.campaigns || email?.campaigns || [])
      .slice(0, 5)
      .map(
        (c) =>
          `  - "${c.name}": sent ${c.sent ?? 0}, open rate ${Number(c.openRate ?? 0).toFixed(1)}%, click rate ${Number(c.clickRate ?? 0).toFixed(1)}%, unsubs ${c.unsubs ?? c.unsubscribes ?? 0}`
      )
      .join('\n');

    // Active automations
    const automations = (email?.overall?.automations || email?.automations || [])
      .filter((a) => a.status === 'active' || a.active)
      .map((a) => `  - ${a.name}: ${a.contacts ?? 0} contacts`)
      .join('\n');

    // Per-list stats
    const hqLists = (email?.hq?.lists || [])
      .map((l) => `  - [HQ] ${l.name}: ${l.contacts ?? 0} contacts, open ${Number(l.openRate ?? 0).toFixed(1)}%, click ${Number(l.clickRate ?? 0).toFixed(1)}%`)
      .join('\n');

    const onlineLists = (email?.online?.lists || [])
      .map((l) => `  - [Online] ${l.name}: ${l.contacts ?? 0} contacts, open ${Number(l.openRate ?? 0).toFixed(1)}%, click ${Number(l.clickRate ?? 0).toFixed(1)}%`)
      .join('\n');

    const prompt = `You are an email marketing coach for PerforMotion. Analyse this email data and return ONLY valid JSON — no markdown, no explanation.

CONTEXT:
- HQ lists: clinical/Brisbane audience (Halaxy Clients, News & Events, MMM Webinar)
- Online lists: powerlifting coaching audience (Perf Classroom, Perf Network)
- Industry averages: open rate 21%, click rate 3%

OVERALL STATS:
- Total contacts: ${email?.overall?.totalContacts ?? email?.totalContacts ?? 'N/A'}
- Overall open rate: ${Number(email?.overall?.openRate ?? email?.openRate ?? 0).toFixed(1)}%
- Overall click rate: ${Number(email?.overall?.clickRate ?? email?.clickRate ?? 0).toFixed(1)}%
- Overall unsub rate: ${Number(email?.overall?.unsubRate ?? email?.unsubRate ?? 0).toFixed(2)}%

RECENT CAMPAIGNS (last 5):
${recentCampaigns || '  No campaign data available'}

ACTIVE AUTOMATIONS:
${automations || '  No automation data available'}

LIST STATS:
${hqLists || '  No HQ list data'}
${onlineLists || '  No Online list data'}

Return ONLY this JSON structure with exactly 3 items in sequenceImprovements, subjectLineTips, and conversionTips:
{
  "overallScore": 68,
  "verdict": "one sentence overall verdict",
  "sequenceImprovements": [
    {
      "list": "list name or 'All'",
      "issue": "specific problem with numbers",
      "fix": "exact action to take",
      "expectedImpact": "what improvement to expect"
    }
  ],
  "subjectLineTips": [
    "Specific subject line recommendation based on current campaign names and open rates"
  ],
  "conversionTips": [
    "Specific tip to get more bookings/purchases from existing list"
  ],
  "nextCampaign": {
    "subject": "recommended subject line",
    "audience": "which list and segment",
    "goal": "what conversion to drive",
    "cta": "exact CTA text"
  }
}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API error ${res.status}: ${errText}`);
    }

    const result = await res.json();
    const text = result.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('No JSON found in Claude response');
    }
    const coaching = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coaching }),
    };
  } catch (err) {
    console.error('ai-email-insights error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
