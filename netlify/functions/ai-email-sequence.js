/**
 * AI Email Sequence Generator
 *
 * Takes raw email copy + sequence context and returns:
 *  - Polished, brand-styled HTML email
 *  - Three subject line variants
 *  - Preview text suggestion
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  ANTHROPIC_API_KEY
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, sequence, brand } = body;
  // email:    { day, subject, previewText, body }
  // sequence: { name, listName, totalEmails, emailIndex }
  // brand:    { hasLogo, hasHeroImage, primaryColor, accentColor }

  const brandColors = {
    navy:  brand?.primaryColor || '#1B2A4A',
    teal:  brand?.accentColor  || '#2ABFBF',
    warm:  '#D4B896',
    green: '#10B981',
  };

  const systemPrompt = `You are an expert email marketer for PerforMotion, an Exercise Physiology facility in Teneriffe, Brisbane.

Brand voice:
- Warm, clinical, community-focused for HQ (Brisbane locals, injury recovery, strength)
- Professional, educational, evidence-based for Online (powerlifting coaching, remote athletes)
- Never use "cure" or "fix" without evidence
- CTAs always link to booking or program page
- Subject lines are conversational, not salesy

Brand colours: Navy ${brandColors.navy}, Teal ${brandColors.teal}, Warm ${brandColors.warm}

You receive raw email copy and must:
1. Polish the copy for brand voice (minimal edits — preserve the author's intent)
2. Produce 3 subject line variants (A: curiosity, B: direct benefit, C: social proof)
3. Suggest preview text (90 chars max)
4. Return a complete HTML email using the provided template

CRITICAL: Return ONLY valid JSON matching this exact schema:
{
  "subjectVariants": ["Subject A", "Subject B", "Subject C"],
  "previewText": "90 char max preview text",
  "polishedBody": "polished plain-text version of the email body",
  "html": "complete HTML email string"
}`;

  const userPrompt = `Sequence: "${sequence.name}" — Email ${sequence.emailIndex + 1} of ${sequence.totalEmails}
Target list: ${sequence.listName}
Send day: Day ${email.day} after subscribing

Subject (draft): ${email.subject || '(none provided — generate one)'}
Preview text: ${email.previewText || '(none provided)'}

Email body (raw copy):
${email.body || '(no body provided — write a compelling email for this position in the sequence)'}

Generate the polished email. For the HTML, use this template structure:
- Header: ${brandColors.navy} background, white PerforMotion wordmark text, ${brandColors.teal} bottom border
- Body: white background, 18px Georgia/serif body font, max-width 600px
- CTA button: ${brandColors.teal} background, white text, rounded corners
- Footer: light grey, small text, unsubscribe placeholder
- All styles must be inline (email client compatibility)`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error: ${res.status} — ${err}`);
    }

    const json = await res.json();
    const raw  = json.content?.[0]?.text || '';

    // Extract JSON from the response
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in AI response');

    const result = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('ai-email-sequence error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
