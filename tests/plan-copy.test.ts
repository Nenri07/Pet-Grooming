import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { landing } from '@/content/landing';
import { forGroomers } from '@/content/for-groomers';
import { PLAN_FEATURES } from '@/content/plan-features';
import { PLANS } from '@/lib/plans';

/**
 * Copy-consistency guard for every pricing / marketing surface. Pure (no DOM):
 * content objects are inspected directly and .tsx sources are read as text.
 *
 * _Requirements: 6.1, 6.5_
 */

const root = resolve(__dirname, '..');
const readSrc = (rel: string): string => readFileSync(join(root, rel), 'utf8');

const marketingDir = 'src/components/marketing';
const marketingSources = readdirSync(join(root, marketingDir))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ file: `${marketingDir}/${f}`, text: readSrc(`${marketingDir}/${f}`) }));

const sourceFiles = [
  { file: 'src/lib/seo/jsonld.ts', text: readSrc('src/lib/seo/jsonld.ts') },
  { file: 'src/components/portal/BillingView.tsx', text: readSrc('src/components/portal/BillingView.tsx') },
  ...marketingSources,
];

const contentObjects = [
  { file: 'landing', text: JSON.stringify(landing) },
  { file: 'for-groomers', text: JSON.stringify(forGroomers) },
];

const fmt = (n: number) => n.toLocaleString('en-US');

describe('plan feature lists are shared across surfaces', () => {
  it('landing pricing cards use PLAN_FEATURES', () => {
    const solo = landing.pricing.plans.find((p) => p.name === 'Solo');
    const pro = landing.pricing.plans.find((p) => p.name === 'Pro');
    expect(solo?.features).toEqual([...PLAN_FEATURES.solo]);
    expect(pro?.features).toEqual([...PLAN_FEATURES.pro]);
  });

  it('for-groomers pricing uses PLAN_FEATURES', () => {
    expect(forGroomers.pricing.solo.features).toEqual([...PLAN_FEATURES.solo]);
    expect(forGroomers.pricing.pro.features).toEqual([...PLAN_FEATURES.pro]);
  });

  it('messaging lines carry the metered allowance from PLANS', () => {
    expect(PLAN_FEATURES.solo.some((f) => f.includes(fmt(PLANS.solo.sms)))).toBe(true);
    expect(PLAN_FEATURES.pro.some((f) => f.includes(fmt(PLANS.pro.sms)))).toBe(true);
  });

  it('BillingView reads PLAN_FEATURES and has no "& more" teaser', () => {
    const src = readSrc('src/components/portal/BillingView.tsx');
    expect(src).toMatch(/import\s*\{[^}]*\bPLAN_FEATURES\b[^}]*\}\s*from\s*'@\/content\/plan-features'/);
    expect(src).toMatch(/PLAN_FEATURES\[/);
    expect(src).not.toContain('& more');
    expect(src).not.toContain('&amp; more');
  });
});

describe('no overclaimed copy', () => {
  const texting = /two-way texting|texting included|text messaging included/i;

  it.each([...contentObjects, ...sourceFiles])('$file does not claim SMS texting', ({ text }) => {
    expect(text).not.toMatch(texting);
  });

  const unbuilt = /review request|custom template|optimi[sz]e day/i;

  it.each(contentObjects)('$file does not mention unbuilt features', ({ text }) => {
    expect(text).not.toMatch(unbuilt);
  });

  // _Requirements: 6.2_
  const proFeature = /order radar|fill my day|on (my|the) way|rebooking autopilot|before\s*\/\s*after/i;
  const soloFeature = /deposit|native calendar|pet card|reminder|client messaging/i;

  const taggedItems = [
    ...landing.features.map((f) => ({ surface: 'landing', title: f.title, pro: f.pro })),
    ...forGroomers.whatYouGet.items.map((i) => ({ surface: 'for-groomers', title: i.title, pro: i.pro })),
  ];

  it('the title patterns match real items on both surfaces', () => {
    const titles = taggedItems.map((i) => i.title);
    expect(titles.some((t) => proFeature.test(t))).toBe(true);
    expect(titles.some((t) => soloFeature.test(t))).toBe(true);
    expect(titles).toContain('Rebooking autopilot');
    expect(titles).toContain('Order Radar routing');
    expect(titles).toContain('Live "on my way" tracking');
  });

  it.each(taggedItems.filter((i) => proFeature.test(i.title)))(
    '$surface "$title" names a Pro feature and is tagged Pro',
    ({ pro }) => {
      expect(pro).toBe(true);
    },
  );

  it.each(taggedItems.filter((i) => soloFeature.test(i.title)))(
    '$surface "$title" names a Solo feature and is not tagged Pro',
    ({ pro }) => {
      expect(pro).toBeFalsy();
    },
  );

  it('route-related comparison rows are marked Pro-only', () => {
    const proLabels = [
      'Route-aware booking',
      'Shows extra driving per booking',
      'Auto-fills cancelled slots',
    ];
    for (const label of proLabels) {
      const row = landing.comparison.rows.find((r) => r.label === label);
      expect(row, label).toBeDefined();
      expect(row?.proOnly, label).toBe(true);
    }
  });
});
