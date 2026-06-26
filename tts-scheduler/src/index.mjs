const RAILWAY_GRAPHQL_URL = process.env.RAILWAY_GRAPHQL_URL || 'https://backboard.railway.com/graphql/v2';
const TZ = 'Asia/Bishkek';
const HEALTH_TIMEOUT_MS = Number(process.env.TTS_HEALTH_TIMEOUT_MS || 30_000);
const HEALTH_RETRIES = Number(process.env.TTS_HEALTH_RETRIES || 12);
const HEALTH_RETRY_DELAY_MS = Number(process.env.TTS_HEALTH_RETRY_DELAY_MS || 10_000);

const SERVERLESS_FIELDS = [
  'sleepApplication',
  'serverless',
  'isServerless',
  'serverlessEnabled',
  'enableServerless',
  'isServerlessEnabled',
];

const REPLICA_FIELDS = ['numReplicas', 'replicas', 'replicaCount'];
const DEPLOY_MUTATIONS = ['serviceInstanceDeployV2', 'serviceInstanceRedeploy'];

function bishkekTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(' ', 'T') + '+06:00';
}

function log(level, message, extra = {}) {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: bishkekTimestamp(),
    ...extra,
  }));
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value || null;
}

function serviceTargets() {
  const configuredTargets = (process.env.SCHEDULER_TARGETS || process.env.TTS_SCHEDULER_TARGETS || 'tts')
    .split(',')
    .map((target) => target.trim().toLowerCase())
    .filter(Boolean);
  const enabled = new Set(configuredTargets);
  if (enabled.has('all')) {
    enabled.add('tts');
    enabled.add('backend');
    enabled.add('frontend');
  }

  const targets = [
    {
      key: 'tts',
      name: 'tts-service',
      serviceId: optionalEnv('RAILWAY_TTS_SERVICE_ID'),
      healthUrl: optionalEnv('TTS_PUBLIC_OR_PRIVATE_HEALTH_URL'),
    },
    {
      key: 'backend',
      name: 'backend',
      serviceId: optionalEnv('RAILWAY_BACKEND_SERVICE_ID'),
      healthUrl: optionalEnv('BACKEND_PUBLIC_OR_PRIVATE_HEALTH_URL'),
    },
    {
      key: 'frontend',
      name: 'frontend',
      serviceId: optionalEnv('RAILWAY_FRONTEND_SERVICE_ID'),
      healthUrl: optionalEnv('FRONTEND_PUBLIC_OR_PRIVATE_HEALTH_URL'),
    },
  ].filter((target) => enabled.has(target.key));

  if (targets.length === 0) {
    throw new Error(`No scheduler targets enabled. Set SCHEDULER_TARGETS to tts, backend, frontend, or all.`);
  }

  const missing = targets.filter((target) => !target.serviceId).map((target) => target.name);
  if (missing.length > 0) {
    throw new Error(`Missing Railway service ids for enabled targets: ${missing.join(', ')}`);
  }

  return targets;
}

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
  };
}

function resolveMode() {
  const cli = process.argv[2]?.toLowerCase();
  const configured = (cli || process.env.SCHEDULER_ACTION || process.env.TTS_SCHEDULER_ACTION || 'auto').toLowerCase();
  if (configured === 'wake' || configured === 'day' || configured === 'serverless_off') return 'wake';
  if (configured === 'night' || configured === 'sleep' || configured === 'serverless_on') return 'night';
  if (configured !== 'auto') {
    throw new Error(`Unsupported SCHEDULER_ACTION: ${configured}`);
  }

  const { hour } = localParts();
  if (hour >= 0 && hour < 4) return 'night';
  if (hour >= 8 && hour < 12) return 'wake';
  throw new Error('auto mode can only infer action near wake/night windows; set SCHEDULER_ACTION=wake or night');
}

async function gql(query, variables, token) {
  const res = await fetch(RAILWAY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.errors?.length) {
    const errors = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(errors);
  }
  return body.data;
}

function fieldNames(type) {
  return new Set((type?.inputFields || type?.fields || []).map((field) => field.name));
}

function mutationMap(schema) {
  return new Map((schema?.mutation?.mutationType?.fields || []).map((field) => [
    field.name,
    new Set((field.args || []).map((arg) => arg.name)),
  ]));
}

async function introspect(token) {
  return gql(`
    query SchedulerIntrospection {
      serviceInstance: __type(name: "ServiceInstance") {
        fields { name }
      }
      updateInput: __type(name: "ServiceInstanceUpdateInput") {
        inputFields { name }
      }
      mutation: __schema {
        mutationType {
          fields { name args { name } }
        }
      }
    }
  `, {}, token);
}

function pickFirst(names, candidates) {
  return candidates.find((name) => names.has(name)) || null;
}

function pickMutation(mutations, candidates) {
  for (const name of candidates) {
    const args = mutations.get(name);
    if (args) return { name, args };
  }
  return null;
}

async function getCurrentMode(token, serviceId, environmentId, instanceFields, serverlessField, replicaField) {
  const fields = ['id'];
  if (serverlessField && instanceFields.has(serverlessField)) fields.push(serverlessField);
  if (replicaField && instanceFields.has(replicaField)) fields.push(replicaField);

  const data = await gql(`
    query CurrentServiceInstance($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        ${fields.join('\n        ')}
      }
    }
  `, { serviceId, environmentId }, token);
  return data.serviceInstance;
}

async function updateServiceInstance(token, serviceId, environmentId, input) {
  const data = await gql(`
    mutation UpdateServiceInstance($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }
  `, { serviceId, environmentId, input }, token);
  return data.serviceInstanceUpdate;
}

async function applyStagedChanges(token, deployMutation, serviceId, environmentId) {
  const variableDefs = [];
  const args = [];
  const variables = {};

  if (deployMutation.args.has('serviceId')) {
    variableDefs.push('$serviceId: String!');
    args.push('serviceId: $serviceId');
    variables.serviceId = serviceId;
  }
  if (deployMutation.args.has('environmentId')) {
    variableDefs.push('$environmentId: String!');
    args.push('environmentId: $environmentId');
    variables.environmentId = environmentId;
  }

  const mutationSignature = variableDefs.length > 0 ? `(${variableDefs.join(', ')})` : '';
  const mutationArgs = args.length > 0 ? `(${args.join(', ')})` : '';

  const data = await gql(`
    mutation ApplyServiceChanges${mutationSignature} {
      ${deployMutation.name}${mutationArgs}
    }
  `, variables, token);

  return data[deployMutation.name];
}

async function pingHealth(url) {
  if (!url) return { skipped: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    return { skipped: false, ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function pingHealthUntilReady(url) {
  if (!url) return { skipped: true };

  let last = { skipped: false, ok: false, status: null, attempt: 0 };
  for (let attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1) {
    try {
      const result = await pingHealth(url);
      last = { ...result, attempt };
      if (result.ok) return last;
    } catch (error) {
      last = {
        skipped: false,
        ok: false,
        status: null,
        attempt,
        error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)),
      };
    }

    if (attempt < HEALTH_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, HEALTH_RETRY_DELAY_MS));
    }
  }

  return last;
}

async function main() {
  const token = requiredEnv('RAILWAY_API_TOKEN');
  requiredEnv('RAILWAY_PROJECT_ID');
  const environmentId = requiredEnv('RAILWAY_ENVIRONMENT_ID');
  const targets = serviceTargets();
  const mode = resolveMode();
  const action = mode === 'wake' ? 'serverless_off' : 'serverless_on';
  const targetServerless = mode === 'night';

  log('info', 'tts-scheduler started', {
    currentMode: mode,
    action,
    targets: targets.map((target) => target.name),
  });

  const schema = await introspect(token);
  const instanceFields = fieldNames(schema.serviceInstance);
  const inputFields = fieldNames(schema.updateInput);
  const mutations = mutationMap(schema);
  const serverlessField = pickFirst(inputFields, SERVERLESS_FIELDS);
  const replicaField = pickFirst(inputFields, REPLICA_FIELDS);
  const deployMutation = pickMutation(mutations, DEPLOY_MUTATIONS);

  if (!serverlessField) {
    const allowReplicaFallback = (process.env.RAILWAY_ALLOW_REPLICA_FALLBACK || 'false') === 'true';
    if (!allowReplicaFallback || !replicaField) {
      throw new Error(
        `Serverless field not found in ServiceInstanceUpdateInput. ` +
        `Check Railway GraphiQL/Network tab and set RAILWAY_SERVERLESS_FIELD if Railway renamed it. ` +
        `Fallback is replicas 1/0 with RAILWAY_ALLOW_REPLICA_FALLBACK=true, but replicas=0 will not wake on night TTS requests.`,
      );
    }
  }

  if (!deployMutation) {
    throw new Error(
      `No deploy mutation found after serviceInstanceUpdate. Expected one of: ${DEPLOY_MUTATIONS.join(', ')}`,
    );
  }

  const effectiveServerlessField = process.env.RAILWAY_SERVERLESS_FIELD?.trim() || serverlessField;
  const effectiveReplicaField = process.env.RAILWAY_REPLICA_FIELD?.trim() || replicaField;
  const input = {};
  if (effectiveServerlessField) {
    input[effectiveServerlessField] = targetServerless;
  } else {
    input[effectiveReplicaField] = mode === 'wake' ? 1 : 0;
  }

  const results = [];
  for (const target of targets) {
    const current = await getCurrentMode(
      token,
      target.serviceId,
      environmentId,
      instanceFields,
      effectiveServerlessField,
      effectiveReplicaField,
    );

    log('info', 'updating service instance', {
      service: target.name,
      currentMode: mode,
      action,
      field: Object.keys(input)[0],
      currentValue: current?.[Object.keys(input)[0]] ?? null,
      targetValue: Object.values(input)[0],
    });

    await updateServiceInstance(token, target.serviceId, environmentId, input);
    log('info', 'applying staged changes', {
      service: target.name,
      currentMode: mode,
      action,
      mutation: deployMutation.name,
    });
    await applyStagedChanges(token, deployMutation, target.serviceId, environmentId);

    let health = { skipped: true };
    if (mode === 'wake') {
      health = await pingHealthUntilReady(target.healthUrl);
      if (target.healthUrl && !health.ok) {
        throw new Error(`${target.name} healthcheck did not become ready after ${health.attempt || 0} attempts`);
      }
    }

    results.push({ service: target.name, health });
  }

  log('info', 'tts-scheduler success', {
    currentMode: mode,
    action,
    success: true,
    results,
  });
}

main().catch((error) => {
  const mode = (() => {
    try { return resolveMode(); } catch { return 'unknown'; }
  })();
  log('error', 'tts-scheduler error', {
    currentMode: mode,
    action: mode === 'night' ? 'serverless_on' : mode === 'wake' ? 'serverless_off' : 'unknown',
    success: false,
    error: error?.message || String(error),
  });
  process.exitCode = 1;
});
