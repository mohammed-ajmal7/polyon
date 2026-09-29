# POLYON v0.1 Release Checklist

This checklist is for the first self-hosted POLYON release candidate. It is the manual release gate and must be executed against the exact release-candidate commit while preserving the operational safety defaults.

## 1. Release metadata

- [ ] Root and workspace package versions agree with `0.1.0`.
- [ ] Product/UI copy identifies the build as the v0.1 release candidate rather than an obsolete development milestone.

## 2. Branch state

- [ ] `develop` contains the intended release candidate.
- [ ] A release branch is created from the exact `develop` commit: `release/0.1.0`.
- [ ] No unreviewed feature branches are included accidentally.
- [ ] `main` remains unchanged until release approval.

## 3. Manual verification

GitHub Actions are intentionally not part of the release gate. Run the complete local verification script on the exact release-candidate commit:

```bash
bash scripts/verify-release.sh
```

The script performs:

- frozen-lockfile dependency installation;
- TypeScript typecheck;
- full Vitest test suite;
- ESLint;
- Prettier format check;
- production build;
- Docker image build;
- Docker Compose configuration validation.

Do not treat a release candidate as verified until the script completes successfully on the exact commit intended for release.

## 4. Configuration and safety

Before enabling consequential execution:

- [ ] `POLYON_EXECUTION_ENABLED=false` has been preserved through initial deployment.
- [ ] `POLYON_APPROVAL_MODE=ASK_EVERYTHING` has been preserved until the approval workflow is tested.
- [ ] `POLYON_API_TOKEN` is configured when the private API is reachable beyond the local machine.
- [ ] model endpoint/credentials are configured only server-side;
- [ ] SMTP credentials, when used, are stored server-side or through the encrypted secret store;
- [ ] research host allowlists are explicit;
- [ ] semantic indexing remains disabled unless an explicit scope allowlist is configured.

## 5. Persistence and recovery

- [ ] Configure a persistent `POLYON_DATA_DIR`.
- [ ] Create a backup before the release upgrade.
- [ ] Verify a backup can be validated and restored in a disposable copy.
- [ ] Restart the service and confirm durable state is recovered.
- [ ] Verify `GET /api/health/live`.
- [ ] Verify `GET /api/health/ready`.
- [ ] Confirm readiness fails closed when required configuration is invalid.

## 6. Functional smoke checks

Run a small end-to-end check covering:

```
request
  -> policy
  -> approval
  -> execution
  -> result
  -> audit/trace
```

Also exercise:

- [ ] durable Mission execution and restart recovery;
- [ ] memory write/search;
- [ ] optional embedding indexing with an explicitly allowed scope;
- [ ] bounded research and evidence-backed synthesis;
- [ ] private web/API authentication;
- [ ] at least one configured integration, only where credentials and approvals are intentionally set;
- [ ] verify the AI HQ workspace pages: Missions, Executions, Approvals, Agents, Memory, Research, Evidence, Artifacts, Activity, and Settings.

## 7. Release

After all checks pass:

1. merge `release/0.1.0` into `main`;
2. tag the released commit as `v0.1.0`;
3. publish the GitHub release notes with the actual supported scope and known limitations;
4. retain the release commit, tag, backup procedure, and CI run as the release record.

## 8. Known post-v0.1 depth work

The first release does not claim:

- advanced MCP/A2A streaming, push, or subscription behavior;
- multi-user/enterprise tenancy;
- sustained production load/profiling coverage;
- target-specific cloud deployment automation.

Keep these as explicit follow-up work rather than undocumented promises.
