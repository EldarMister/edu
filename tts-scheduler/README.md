# tts-scheduler

Small Railway cron service for switching only `tts-service` between day and night modes.

Goal:

- day: Serverless off, apply staged changes, then warm TTS via `/health` until it responds
- night: Serverless on, no health ping, so Railway can sleep after inactivity
- backend, frontend and Postgres are not touched

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
# auto | wake | night
SCHEDULER_ACTION=auto

# If Railway renames the ServiceInstanceUpdateInput field, verify it in
# railway.com/graphiql or Dashboard Network tab and set it here.
RAILWAY_SERVERLESS_FIELD=

# Last-resort fallback. Warning: replicas=0 will not wake on night TTS requests.
RAILWAY_ALLOW_REPLICA_FALLBACK=false
RAILWAY_REPLICA_FIELD=

# Wake-mode health retry loop.
TTS_HEALTH_RETRIES=12
TTS_HEALTH_RETRY_DELAY_MS=10000
```

## Railway setup

Railway cron schedules are UTC.

Use the same source directory (`tts-scheduler`) for both cron jobs:

| Job | Action | Cron schedule |
| --- | --- | --- |
| wake | `SCHEDULER_ACTION=wake` | `0 3 * * *` |
| night mode | `SCHEDULER_ACTION=night` | `10 18 * * *` |

`0 3 * * *` is 09:00 in Asia/Bishkek. If the intended day switch is exactly
10:00 Asia/Bishkek, use `0 4 * * *` instead.

Native Railway cron currently stores one cron expression per service. If the
dashboard does not allow two schedules on one service, create two tiny Railway
cron services from this same folder:

- `tts-scheduler-wake` with `SCHEDULER_ACTION=wake`
- `tts-scheduler-night` with `SCHEDULER_ACTION=night`

Both still modify only `RAILWAY_TTS_SERVICE_ID`.

Important: `serviceInstanceUpdate` creates staged changes in Railway. The
scheduler must also trigger a deploy/redeploy mutation so the updated
Serverless value is actually applied to `tts-service`.

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
