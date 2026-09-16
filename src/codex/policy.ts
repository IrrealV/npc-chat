import { BridgeError, type QuotaCategory } from './rpc.js';

export const EVENT = 'El streamer dice que no se caerá y acto seguido cae al vacío';
export const PROMPT = `Comentá en español con una sola frase corta e irónica, sin herramientas: «${EVENT}».`;
export const TEXT_MODELS = ['gpt-5.6-luna', 'gpt-5.3-codex-spark'] as const;
export const LIVE_MODELS = ['gpt-live-1-codex', 'gpt-realtime-1.5'] as const;
export const CONFIG: Record<string, string | number | boolean> = {
  forced_login_method: 'chatgpt', cli_auth_credentials_store: 'ephemeral',
  model_provider: 'openai', model_reasoning_effort: 'low', service_tier: 'default',
  approval_policy: 'on-request', approvals_reviewer: 'user', sandbox_mode: 'read-only',
  web_search: 'disabled', project_doc_max_bytes: 0,
  'history.persistence': 'none', 'analytics.enabled': false,
  'agents.enabled': false, 'apps._default.enabled': false,
  'features.shell_tool': false, 'features.unified_exec': false,
  'features.shell_snapshot': false, 'features.skip_host_skill_discovery': true,
  'features.hooks': false, 'features.plugins': false, 'features.memories': false,
  'features.apps': false,
};
export function serverCommand(): string[] {
  return [...Object.entries(CONFIG).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]), 'app-server'];
}

export function assertLoginReadinessSchema(completion: any, update: any): void {
  const invalid = () => { throw new BridgeError('pinned_schema_missing_or_incompatible'); };
  const idType = completion?.properties?.loginId?.type;
  if (completion?.properties?.success?.type !== 'boolean' || !Array.isArray(idType)
    || !idType.includes('string') || !idType.includes('null')
    || !update?.properties || Object.hasOwn(update.properties, 'loginId')) invalid();
  for (const [field, definition] of [['authMode', 'AuthMode'], ['planType', 'PlanType']]) {
    const alternatives = update.properties[field]?.anyOf;
    if (!Array.isArray(alternatives) || !alternatives.some((value: any) => value.type === 'null')
      || !alternatives.some((value: any) => value.$ref === `#/definitions/${definition}`)) invalid();
  }
}

export function accountSummary(response: unknown): { type: 'chatgpt'; planType: string } {
  const reject = (category: 'account_missing' | 'non_chatgpt_account' | 'unsupported_plan' | 'invalid_account_shape'): never => {
    throw new BridgeError('subscription_auth_required', category);
  };
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (response == null) return reject('account_missing');
  if (!record(response)) return reject('invalid_account_shape');
  const account = response.account;
  if (account == null) return reject('account_missing');
  if (!record(account)) return reject('invalid_account_shape');
  if (account.type === 'apiKey' || account.type === 'amazonBedrock') return reject('non_chatgpt_account');
  if (account.type !== 'chatgpt' || typeof account.planType !== 'string') return reject('invalid_account_shape');
  if (['go', 'plus', 'pro', 'prolite'].includes(account.planType)) return { type: 'chatgpt', planType: account.planType };
  // Other values in the pinned PlanType enum are recognizable but never approved.
  if (['free', 'team', 'self_serve_business_prolite', 'self_serve_business_usage_based', 'business',
    'ent26', 'enterprise_cbp_automation', 'enterprise_cbp_usage_based', 'enterprise',
    'edu', 'edu_plus', 'edu_pro', 'unknown'].includes(account.planType)) return reject('unsupported_plan');
  return reject('invalid_account_shape');
}

export function assertIncludedUsage(response: unknown, model: string): void {
  const reject = (category: QuotaCategory): never => { throw new BridgeError('included_usage_unavailable', category); };
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const selectionBucket = (value: unknown): Record<string, unknown> => {
    if (!record(value) || (value.normalModelSlug !== null && typeof value.normalModelSlug !== 'string')) {
      return reject('buckets_missing_or_invalid');
    }
    return value;
  };
  // Order: response, ordinary grant, all selection shapes, Spark identity, then each selected bucket.
  if (!record(response)) return reject('buckets_missing_or_invalid');
  if (response.ordinaryUsageAllowed === false) return reject('ordinary_permission_denied');
  if (response.ordinaryUsageAllowed !== true) return reject('ordinary_permission_unavailable');
  const buckets = [selectionBucket(response.rateLimits)];
  const map = response.rateLimitsByLimitId;
  if (map !== null && !record(map)) return reject('buckets_missing_or_invalid');
  // Validate even unrelated entries before selection so malformed aliases cannot hide.
  for (const [id, value] of Object.entries(map === null ? {} : map)) {
    const bucket = selectionBucket(value);
    if (id === 'codex' || id === model || bucket.normalModelSlug === model) buckets.push(bucket);
  }
  if (model === 'gpt-5.3-codex-spark' && !buckets.some((bucket) => bucket.normalModelSlug === model)) {
    throw new BridgeError('model_quota_unknown');
  }
  for (const bucket of buckets) {
    if (bucket.spendControlReached === true) return reject('spend_control_blocked');
    // Null remains unavailable supplementary information, never authority or recovery.
    if (bucket.spendControlReached !== false && bucket.spendControlReached !== null) {
      return reject('spend_control_missing_or_invalid');
    }
    if (bucket.rateLimitReachedType !== null) return reject('reached_type_present_or_invalid');
    const percentages: number[] = [];
    for (const window of [bucket.primary, bucket.secondary]) {
      if (window === null) continue;
      if (!record(window) || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)
        || window.usedPercent < 0) return reject('windows_missing_or_invalid');
      percentages.push(window.usedPercent);
    }
    if (percentages.length === 0) return reject('windows_absent');
    if (percentages.some((value) => value >= 100)) return reject('windows_exhausted');
  }
}

export function selectModel(models: any[], plan: string): string {
  for (const name of TEXT_MODELS) {
    const model = models.find((entry) => entry?.model === name);
    if (!model || model.hidden !== false || model.availabilityNux != null) continue;
    if (name.endsWith('spark') && plan !== 'pro') continue;
    if (!model.inputModalities?.includes('text')
      || !model.supportedReasoningEfforts?.some((effort: any) => effort.reasoningEffort === 'low')) continue;
    return name;
  }
  throw new BridgeError('pinned_text_model_unavailable');
}

export function threadParams(model: string): Record<string, any> {
  return {
    model, modelProvider: 'openai', allowProviderModelFallback: false,
    serviceTier: 'default', cwd: '/work', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only',
    ephemeral: true, environments: [], selectedCapabilityRoots: [], dynamicTools: [],
    experimentalRawEvents: false,
    developerInstructions: 'Respond only with short Spanish text. Never use tools, files, commands, web access, or agents.',
  };
}

export function assertThread(response: any, model: string): string {
  if (response?.model !== model || response.modelProvider !== 'openai'
    || response.serviceTier !== 'default' || response.reasoningEffort !== 'low'
    || !Array.isArray(response.instructionSources) || response.instructionSources.length !== 0
    || response.sandbox?.type !== 'readOnly' || response.sandbox.networkAccess !== false
    || !['on-request', 'untrusted'].includes(response.approvalPolicy) || response.approvalsReviewer !== 'user'
    || response.thread?.ephemeral !== true || response.thread?.path !== null
    || !Array.isArray(response.thread?.environments) || response.thread.environments.length !== 0
    || typeof response.thread?.id !== 'string') throw new BridgeError('thread_policy_mismatch');
  return response.thread.id;
}
