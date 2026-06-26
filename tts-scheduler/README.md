# tts-scheduler

Small Railway cron service for switching selected Railway services between day
and night modes.

Goal:

- day: Serverless off, apply staged changes, then warm configured health URLs until they respond
- night: Serverless on, no health ping, so Railway can sleep after inactivity
- targets are controlled by `SCHEDULER_TARGETS`
- Postgres is not touched

## Required variables

```env
RAILWAY_API_TOKEN=
RAILWAY_PROJECT_ID=
RAILWAY_ENVIRONMENT_ID=
RAILWAY_TTS_SERVICE_ID=
TTS_PUBLIC_OR_PRIVATE_HEALTH_URL=https://.../health
```

Optional:

```env
RAILWAY_BACKEND_SERVICE_ID=
RAILWAY_FRONTEND_SERVICE_ID=
BACKEND_PUBLIC_OR_PRIVATE_HEALTH_URL=https://.../api/health
FRONTEND_PUBLIC_OR_PRIVATE_HEALTH_URL=https://.../

# tts | backend,frontend | all
SCHEDULER_TARGETS=tts

# auto | wake | night
SCHEDULER_ACTION=auto

# If Railway renames the ServiceInstanceUpdateInput field, verify it in
# railway.com/graphiql or Dashboard Network tab and set it here.
RAILWAY_SERVERLESS_FIELD=

# Last-resort fallback. Warning: replicas=0 will not wake on night TTS requests.
RAILWAY_ALLOW_REPLICA_FALLBACK=false
RAILWAY_REPLICA_FIELD=

# Wake-mode health retry loop. These values are shared by all configured
# health URLs.
TTS_HEALTH_RETRIES=12
TTS_HEALTH_RETRY_DELAY_MS=10000
```

## Railway setup

Railway cron schedules are UTC.

Use the same source directory (`tts-scheduler`) for cron jobs:

| Job | Targets | Action | Cron schedule |
| --- | --- | --- | --- |
| tts wake | `SCHEDULER_TARGETS=tts` | `SCHEDULER_ACTION=wake` | `0 3 * * *` |
| tts night | `SCHEDULER_TARGETS=tts` | `SCHEDULER_ACTION=night` | `10 18 * * *` |
| app wake | `SCHEDULER_TARGETS=backend,frontend` | `SCHEDULER_ACTION=wake` | `0 3 * * *` |
| app night | `SCHEDULER_TARGETS=backend,frontend` | `SCHEDULER_ACTION=night` | `0 19 * * *` |

Railway cron schedules are UTC. In Asia/Bishkek:

- `0 3 * * *` is 09:00.
- `10 18 * * *` is 00:10.
- `0 19 * * *` is 01:00 on the next local day.

Native Railway cron currently stores one cron expression per service. Create
separate tiny Railway cron services from this same folder when schedules differ:

- `tts-scheduler-wake` with `SCHEDULER_ACTION=wake`
- `tts-scheduler-night` with `SCHEDULER_ACTION=night`
- `app-scheduler-wake` with `SCHEDULER_ACTION=wake`
- `app-scheduler-night` with `SCHEDULER_ACTION=night`

`tts-scheduler-*` should use `SCHEDULER_TARGETS=tts`.
`app-scheduler-*` should use `SCHEDULER_TARGETS=backend,frontend`.

For the setup shown in Railway, add these variables to both app scheduler services:

```env
RAILWAY_BACKEND_SERVICE_ID=<backend service id>
RAILWAY_FRONTEND_SERVICE_ID=<frontend service id>
BACKEND_PUBLIC_OR_PRIVATE_HEALTH_URL=https://edu-production-2395.up.railway.app/api/health
FRONTEND_PUBLIC_OR_PRIVATE_HEALTH_URL=https://edu-pos.up.railway.app/
```

Important: `serviceInstanceUpdate` creates staged changes in Railway. The
scheduler must also trigger a deploy/redeploy mutation so the updated
Serverless value is actually applied to each configured service.

## GraphQL field verification

The scheduler uses Railway GraphQL introspection to look for common Serverless
fields in `ServiceInstanceUpdateInput`:

- `sleepApplication`
- `serverless`
- `isServerless`
- `serverlessEnabled`
- `enableServerless`
- `isServerlessEnabled`

If Railway changes the schema, do the Serverless toggle manually in Railway
Dashboard and inspect the GraphQL request in the browser Network tab, or open
`railway.com/graphiql`, find `ServiceInstanceUpdateInput`, then set
`RAILWAY_SERVERLESS_FIELD` to the exact field name.

## Local check

```bash
npm run check
SCHEDULER_ACTION=wake npm start
SCHEDULER_ACTION=night npm start
```

The process performs one task and exits. Logs are JSON and include:

- `currentMode`
- `action`
- `success` or `error`
- `timestamp` in Asia/Bishkek
