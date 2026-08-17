# LUA-X Production Hardening

## Scope

Production hardening covers security, reliability, permissions, abuse resistance, observability, and scaling boundaries around the Phase 10/11 platform.

## Security

- Authentication is required before protected mutations.
- Authorization is project-scoped and role-based.
- Required roles are explicit per mutation type.
- Destructive high/critical-risk operations require an approval signal.
- Secret operations require admin-level permission.
- Audit records include actor, project, request, action, outcome, and timestamp.
- Never log API keys, access tokens, cookies, or raw secret values.
- Treat AI output as untrusted input. Validate structured outputs before applying them.
- Keep Roblox client requests non-authoritative for protected game state.
- Apply least privilege to Studio/cloud connectors.

## Reliability

- External operations need timeouts and bounded retries.
- Exponential backoff must be capped.
- Do not retry non-idempotent destructive operations blindly.
- Use request IDs for tracing and idempotency keys where a provider supports them.
- Health checks must distinguish `up`, `degraded`, and `down` dependencies.
- Fail closed for authorization and fail safe for destructive automation.
- Autonomous repair must remain bounded by the Phase 9 repair budget.

## Permissions

Roles are project-scoped. Suggested policy:

| Operation | Minimum role |
|---|---|
| Read | viewer |
| Write code/assets | developer |
| Execute build/playtest | developer |
| Delete | admin |
| Publish | admin + approval for risky operations |
| Secrets | admin |

Ownership, organization policy, and environment policy can impose stricter requirements.

## Rate limits and scaling

Use rate limits at multiple boundaries:

```text
user → project → IP/session → provider → Studio session
```

Separate quotas for expensive operations such as AI generation, autonomous builds, playtests, screenshots, and cloud jobs.

For scale:

```text
API
 ↓
stateless application nodes
 ↓
queue
 ↓
workers
 ├── AI jobs
 ├── Studio jobs
 ├── verification
 └── cloud tasks
 ↓
durable database + object storage
```

Do not hold long-running Studio/AI jobs inside ordinary HTTP requests.

## Data protection

- Encrypt data in transit and at rest using infrastructure-supported mechanisms.
- Store secrets in a dedicated secret manager in production.
- Never commit credentials to Git.
- Define retention/deletion policies before collecting telemetry.
- Minimize stored project data to what the product actually needs.

## Observability

Every significant operation should have:
- request/correlation ID
- project ID
- actor ID where appropriate
- operation type
- duration
- outcome
- sanitized error category

Metrics should cover latency, queue depth, job success/failure, provider errors, Studio availability, verification pass rate, repair rate, and resource utilization.

## Deployment gates

A production release should require:

1. typecheck/build
2. unit tests
3. integration tests
4. dependency/security scanning
5. migration review
6. configuration validation
7. smoke test
8. rollback plan
9. health checks
10. post-deploy monitoring

## Disaster recovery

Production must define backup frequency, restore testing, recovery point objective (RPO), recovery time objective (RTO), and procedures for provider/Studio outages.

## Definition of done

This hardening package provides deterministic policy primitives and documentation. It is **not** a claim that a production cloud has already been deployed. Production completion additionally requires real infrastructure, secret management, persistent storage, queues, monitoring, security review, load testing, backup/restore drills, and end-to-end Studio validation.
