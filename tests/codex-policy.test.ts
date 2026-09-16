import { describe, expect, it } from 'vitest';
import { accountSummary, assertIncludedUsage, assertLoginReadinessSchema, assertThread, CONFIG, selectModel, serverCommand, threadParams } from '../src/codex/policy.js';

const bucket = { normalModelSlug: null, primary: { usedPercent: 20 }, secondary: { usedPercent: 10 }, rateLimitReachedType: null, spendControlReached: false };
const usage = () => ({ ordinaryUsageAllowed: true, rateLimits: { ...bucket }, rateLimitsByLimitId: null });
const luna = 'gpt-5.6-luna';
function rejectsUsage(response: unknown, category: string, model = luna) {
  expect(() => assertIncludedUsage(response, model)).toThrowError(expect.objectContaining({
    code: 'included_usage_unavailable', message: 'included_usage_unavailable', category,
  }));
}

describe('included quota contract', () => {
  it.each(['primary', 'secondary', 'both'])('accepts %s windows and nullable spend only with ordinary permission', (present) => {
    for (const spendControlReached of [false, null]) {
      const valid = { ...bucket, spendControlReached,
        primary: present === 'secondary' ? null : { usedPercent: 0 },
        secondary: present === 'primary' ? null : { usedPercent: 99.9 } };
      expect(() => assertIncludedUsage({ ...usage(), rateLimits: valid, rateLimitsByLimitId: {
        codex: valid, [luna]: valid, alias: { ...valid, normalModelSlug: luna },
      } }, luna)).not.toThrow();
    }
  });
  it.each([undefined, [], 'fixture', false, 42])('rejects invalid bucket maps, case %#', (rateLimitsByLimitId) => {
    rejectsUsage({ ...usage(), rateLimitsByLimitId }, 'buckets_missing_or_invalid');
  });
  it.each([undefined, null, [], 42, 'fixture', {},
    { ...bucket, normalModelSlug: undefined }, { ...bucket, normalModelSlug: [luna] },
    { ...bucket, normalModelSlug: { model: luna } }, { ...bucket, normalModelSlug: true },
  ])('validates entries and alias discriminators before skipping unrelated keys, case %#', (unrelated) => {
    rejectsUsage({ ...usage(), rateLimitsByLimitId: { unrelated } }, 'buckets_missing_or_invalid');
  });
  it.each([
    [{ ordinaryUsageAllowed: undefined }, 'ordinary_permission_unavailable'],
    [{ ordinaryUsageAllowed: false }, 'ordinary_permission_denied'],
    [{ rateLimits: null }, 'buckets_missing_or_invalid'],
    [{ rateLimits: { ...bucket, spendControlReached: true } }, 'spend_control_blocked'],
    [{ rateLimits: { ...bucket, spendControlReached: undefined } }, 'spend_control_missing_or_invalid'],
    [{ rateLimits: { ...bucket, rateLimitReachedType: 'fixture' } }, 'reached_type_present_or_invalid'],
    [{ rateLimits: { ...bucket, primary: undefined } }, 'windows_missing_or_invalid'],
    [{ rateLimits: { ...bucket, primary: null, secondary: null } }, 'windows_absent'],
    [{ rateLimits: { ...bucket, primary: { usedPercent: 100 } } }, 'windows_exhausted'],
  ] as const)('returns only a fixed quota category, case %#', (patch, category) => {
    rejectsUsage({ ...usage(), ...patch }, category);
  });
  it('never derives ordinary permission from healthy windows, credits or reset times', () => {
    for (const ordinaryUsageAllowed of [false, null, undefined, 0, 1, 'true', {}, []]) {
      rejectsUsage({ ...usage(), ordinaryUsageAllowed, rateLimits: { ...bucket, spendControlReached: null,
        credits: { unlimited: true, balance: '1000' }, primary: { usedPercent: 0, resetsAt: 0 } } },
      ordinaryUsageAllowed === false ? 'ordinary_permission_denied' : 'ordinary_permission_unavailable');
    }
    rejectsUsage({ rateLimits: bucket, rateLimitsByLimitId: null }, 'ordinary_permission_unavailable');
  });
  it('requires response/base objects, including the base discriminator, and explicit windows', () => {
    for (const value of [undefined, null, false, 42, 'fixture', [], Object.assign([], usage())]) {
      rejectsUsage(value, 'buckets_missing_or_invalid');
      rejectsUsage({ ...usage(), rateLimits: value }, 'buckets_missing_or_invalid');
    }
    for (const normalModelSlug of [undefined, false, 42, [], {}]) {
      rejectsUsage({ ...usage(), rateLimits: { ...bucket, normalModelSlug } }, 'buckets_missing_or_invalid');
    }
    rejectsUsage({ ...usage(), rateLimits: Object.assign([], bucket) }, 'buckets_missing_or_invalid');
    const { primary, secondary, ...withoutWindows } = bucket;
    for (const rateLimits of [withoutWindows, { ...withoutWindows, primary }, { ...withoutWindows, secondary }]) {
      rejectsUsage({ ...usage(), rateLimits }, 'windows_missing_or_invalid');
    }
  });
  it.each(['base', 'codex', luna, 'alias'])('enforces every gate independently in %s; healthy buckets cannot substitute', (target) => {
    const failures: [Record<string, unknown>, string][] = [
      [{ spendControlReached: true }, 'spend_control_blocked'],
      ...[undefined, 0, 'false', [], {}].map((spendControlReached): [Record<string, unknown>, string] =>
        [{ spendControlReached }, 'spend_control_missing_or_invalid']),
      ...[undefined, false, true, 0, '', [], {}, 'fixture', 'rate_limit_reached', 'workspace_owner_credits_depleted',
        'workspace_member_credits_depleted', 'workspace_owner_usage_limit_reached', 'workspace_member_usage_limit_reached']
        .map((rateLimitReachedType): [Record<string, unknown>, string] => [{ rateLimitReachedType }, 'reached_type_present_or_invalid']),
      [{ primary: null, secondary: null }, 'windows_absent'],
    ];
    for (const field of ['primary', 'secondary']) {
      for (const window of [undefined, false, 42, 'fixture', [], Object.assign([], { usedPercent: 0 }), {},
        ...[undefined, null, '0', false, NaN, Infinity, -Infinity, -1].map((usedPercent) => ({ usedPercent }))]) {
        failures.push([{ [field]: window }, 'windows_missing_or_invalid']);
      }
      for (const usedPercent of [100, 101, Number.MAX_VALUE]) failures.push([{ [field]: { usedPercent } }, 'windows_exhausted']);
    }
    for (const [patch, category] of failures) {
      const invalid = { ...bucket, ...patch, normalModelSlug: target === 'alias' ? luna : null };
      rejectsUsage({ ...usage(), rateLimits: target === 'base' ? invalid : bucket, rateLimitsByLimitId: {
        codex: bucket, [luna]: bucket, alias: { ...bucket, normalModelSlug: luna }, unrelated: bucket,
        ...(target === 'base' ? {} : { [target]: invalid }),
      } }, category);
    }
  });
  it('accepts mixed applicable windows and ignores only well-identified unrelated quota state', () => {
    expect(() => assertIncludedUsage({ ...usage(), rateLimitsByLimitId: {
      codex: { ...bucket, primary: null, spendControlReached: null }, [luna]: { ...bucket, secondary: null },
      alias: { ...bucket, normalModelSlug: luna, primary: null },
      unrelated: { ...bucket, normalModelSlug: 'other', spendControlReached: true, primary: { usedPercent: 100 } },
    } }, luna)).not.toThrow();
    expect(() => assertIncludedUsage({ ...usage(), rateLimitsByLimitId: {} }, luna)).not.toThrow();
  });
  it('preserves Spark identification and Pro-only catalog selection', () => {
    const spark = 'gpt-5.3-codex-spark';
    for (const rateLimitsByLimitId of [null, { [spark]: bucket }]) {
      expect(() => assertIncludedUsage({ ...usage(), rateLimitsByLimitId }, spark)).toThrow('model_quota_unknown');
    }
    const identified = { ...bucket, normalModelSlug: spark, primary: null, spendControlReached: null };
    expect(() => assertIncludedUsage({ ...usage(), rateLimits: identified }, spark)).not.toThrow();
    expect(() => assertIncludedUsage({ ...usage(), rateLimitsByLimitId: { alias: identified } }, spark)).not.toThrow();
    rejectsUsage({ ...usage(), rateLimitsByLimitId: { alias: { ...identified, secondary: null } } }, 'windows_absent', spark);
    const catalog = [{ model: spark, hidden: false, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }];
    expect(selectModel(catalog, 'pro')).toBe(spark);
    for (const plan of ['go', 'plus', 'prolite']) expect(() => selectModel(catalog, plan)).toThrow('pinned_text_model_unavailable');
  });
  it('uses deterministic rejection precedence without reporting payload details', () => {
    rejectsUsage({ ...usage(), ordinaryUsageAllowed: false, rateLimitsByLimitId: undefined }, 'ordinary_permission_denied');
    rejectsUsage({ ...usage(), rateLimits: { ...bucket, spendControlReached: true },
      rateLimitsByLimitId: { unrelated: {} } }, 'buckets_missing_or_invalid');
    rejectsUsage({ ...usage(), rateLimits: { ...bucket, spendControlReached: true, rateLimitReachedType: 'fixture' } }, 'spend_control_blocked');
    rejectsUsage({ ...usage(), rateLimits: { ...bucket, rateLimitReachedType: false, primary: undefined } }, 'reached_type_present_or_invalid');
    rejectsUsage({ ...usage(), rateLimits: { ...bucket, primary: { usedPercent: 100 }, secondary: undefined } }, 'windows_missing_or_invalid');
    rejectsUsage({ ...usage(), rateLimits: { ...bucket, primary: null, secondary: null },
      rateLimitsByLimitId: { codex: { ...bucket, spendControlReached: true } } }, 'windows_absent');
  });
});

describe('subscription-only policy', () => {
  it('disables the child Apps registration feature while retaining per-app restrictions', () => {
    expect(CONFIG['features.apps']).toBe(false);
    expect(CONFIG['apps._default.enabled']).toBe(false);
    const args = serverCommand();
    expect(args).toContain('features.apps=false');
    expect(args[args.indexOf('features.apps=false') - 1]).toBe('-c');
    expect(args).toContain('apps._default.enabled=false');
    expect(args).toContain('features.plugins=false');
    expect(args).toContain('features.hooks=false');
  });
  it('does not pass the removed and ineffective tool_search feature override', () => {
    expect(CONFIG).not.toHaveProperty('features.tool_search');
    expect(serverCommand()).not.toContain('features.tool_search=false');
  });
  it('projects only ChatGPT type and plan, never personal fields', () => {
    expect(accountSummary({ account: { type: 'chatgpt', planType: 'plus', email: 'fixture@example.invalid', id: 'fixture' } }))
      .toEqual({ type: 'chatgpt', planType: 'plus' });
    for (const account of [null, { type: 'apiKey' }, { type: 'chatgptAuthTokens' }, { type: 'chatgpt', planType: 'unknown' }]) {
      expect(() => accountSummary({ account })).toThrow();
    }
  });
  it('checks the pinned nullable readiness fields without inventing an update login ID', () => {
    const completion = { properties: { success: { type: 'boolean' }, loginId: { type: ['string', 'null'] } } };
    const update = { properties: { authMode: { anyOf: [{ $ref: '#/definitions/AuthMode' }, { type: 'null' }] },
      planType: { anyOf: [{ $ref: '#/definitions/PlanType' }, { type: 'null' }] } } };
    expect(() => assertLoginReadinessSchema(completion, update)).not.toThrow();
    for (const invalid of [{ properties: {} }, { properties: { ...update.properties, loginId: { type: 'string' } } },
      { properties: { ...update.properties, authMode: { type: 'string' } } }]) {
      expect(() => assertLoginReadinessSchema(completion, invalid)).toThrow('pinned_schema_missing_or_incompatible');
    }
    expect(() => assertLoginReadinessSchema({ properties: {} }, update)).toThrow('pinned_schema_missing_or_incompatible');
  });
  it('keeps exactly the same four allowed personal plans', () => {
    for (const planType of ['go', 'plus', 'pro', 'prolite']) {
      const account = { type: 'chatgpt', planType, get email() { throw new Error('must not read personal data'); } };
      expect(accountSummary({ account })).toEqual({ type: 'chatgpt', planType });
    }
  });
  it.each([
    [null, 'account_missing'], [{}, 'account_missing'], [{ account: null }, 'account_missing'],
    [{ account: { type: 'apiKey' } }, 'non_chatgpt_account'],
    [{ account: { type: 'amazonBedrock' } }, 'non_chatgpt_account'],
    [{ account: { type: 'chatgpt', planType: 'free' } }, 'unsupported_plan'],
    [{ account: { type: 'chatgpt', planType: 'unknown' } }, 'unsupported_plan'],
    [{ account: { type: 'chatgpt', planType: 'enterprise_cbp_usage_based' } }, 'unsupported_plan'],
    [{ account: [] }, 'invalid_account_shape'], [{ account: 'untrusted arbitrary detail' }, 'invalid_account_shape'],
    [{ account: { type: 'untrusted arbitrary detail' } }, 'invalid_account_shape'],
    [{ account: { type: 'chatgpt' } }, 'invalid_account_shape'],
    [{ account: { type: 'chatgpt', planType: 42 } }, 'invalid_account_shape'],
    [{ account: { type: 'chatgpt', planType: 'untrusted arbitrary detail' } }, 'invalid_account_shape'],
  ])('returns only a fixed privacy-safe rejection category: %j', (response, category) => {
    let rejection: any;
    try { accountSummary(response); } catch (error) { rejection = error; }
    expect(rejection).toMatchObject({ code: 'subscription_auth_required', category });
    expect(JSON.stringify(rejection)).not.toContain('untrusted arbitrary detail');
    expect(rejection.message).toBe('subscription_auth_required');
  });
  it('requires authoritative ordinary allowance and unexhausted known windows', () => {
    expect(() => assertIncludedUsage(usage(), 'gpt-5.6-luna')).not.toThrow();
    for (const ordinaryUsageAllowed of [null, false, undefined]) {
      expect(() => assertIncludedUsage({ ...usage(), ordinaryUsageAllowed }, 'gpt-5.6-luna')).toThrow();
    }
    for (const usedPercent of [100, 101, -1, null, NaN, undefined]) {
      const response = usage();
      response.rateLimits.primary = { usedPercent: usedPercent as number };
      expect(() => assertIncludedUsage(response, 'gpt-5.6-luna')).toThrow();
    }
    expect(() => assertIncludedUsage({ ...usage(), rateLimits: { ...bucket, rateLimitReachedType: 'workspace_owner_credits_depleted' } }, 'gpt-5.6-luna')).toThrow();
  });
  it('requires the loaded thread to report an explicitly empty environment selection', () => {
    const valid = { model: 'gpt-5.6-luna', modelProvider: 'openai', serviceTier: 'default', reasoningEffort: 'low',
      instructionSources: [], sandbox: { type: 'readOnly', networkAccess: false },
      approvalPolicy: 'on-request', approvalsReviewer: 'user',
      thread: { id: 'fixture', ephemeral: true, path: null, environments: [] } };
    expect(assertThread(valid, valid.model)).toBe('fixture');
    for (const environments of [null, undefined, [{ id: 'fixture' }]]) {
      expect(() => assertThread({ ...valid, thread: { ...valid.thread, environments } }, valid.model)).toThrow();
    }
    expect(() => assertThread({ ...valid, instructionSources: ['/sandbox/fixture'] }, valid.model)).toThrow();
  });
  it('selects only pinned catalog models with low effort, no entitlement inference', () => {
    const model = { model: 'gpt-5.6-luna', hidden: false, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'low' }] };
    expect(selectModel([model], 'plus')).toBe('gpt-5.6-luna');
    for (const candidate of [{ ...model, hidden: true }, { ...model, model: 'unknown-model' },
      { ...model, supportedReasoningEfforts: [] }, { ...model, availabilityNux: { message: 'upgrade' } }]) {
      expect(() => selectModel([candidate], 'plus')).toThrow();
    }
    expect(() => selectModel([{ ...model, model: 'gpt-5.3-codex-spark' }], 'plus')).toThrow();
  });
  it('disables environment access explicitly, without per-turn capability discovery', () => {
    expect(threadParams('gpt-5.6-luna')).toMatchObject({
      environments: [], selectedCapabilityRoots: [], dynamicTools: [], ephemeral: true,
      sandbox: 'read-only', serviceTier: 'default', allowProviderModelFallback: false,
    });
  });
});
