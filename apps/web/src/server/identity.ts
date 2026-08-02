import 'server-only';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Who a job belongs to, when nobody has signed in.
 *
 * §8 says the core path must work without an account, because requiring one
 * destroys the SEO funnel — but free work still has to be rate limited, so an
 * anonymous job needs to be attributable to *someone* without being
 * attributable to a *person*.
 *
 * So: a salted hash of coarse request properties. Deliberately weak as
 * identification and deliberately not reversible. It is a speed bump against
 * casual abuse, not a fingerprint in the tracking sense — no cookie, no
 * storage, nothing that follows anyone between sites, and the salt means the
 * value cannot be correlated with anything outside this deployment.
 *
 * Anyone determined can defeat it. That is fine: §8 says the conversion driver
 * is AI subtitles and large files, not quota enforcement.
 */
const SALT = process.env.ANON_SALT ?? 'editz-anon-salt';

export function anonFingerprint(request: NextRequest): string {
  // Only the /24 of the address: enough to distinguish networks, not enough to
  // single out a household, and stable across the address churn a mobile
  // connection does constantly.
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() ?? '';
  const network = ip.includes('.') ? ip.split('.').slice(0, 3).join('.') : ip;

  const agent = request.headers.get('user-agent') ?? '';
  const language = request.headers.get('accept-language')?.split(',')[0] ?? '';

  return createHash('sha256')
    .update([SALT, network, agent, language].join('\n'))
    .digest('hex')
    .slice(0, 32);
}
