# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability.

Use GitHub's private security reporting flow for this repository when available.
Include enough detail to reproduce the issue, the affected component or endpoint,
the potential impact, and any safe mitigation you have identified.

Do not include secrets, credentials, access tokens, or private user data in a
public issue or pull request.

## Deployment safety

POLYON is intended to be self-hosted. Before exposing an instance beyond the
local machine:

- configure private API authentication with `POLYON_API_TOKEN`;
- keep execution disabled until the deployment is configured and tested;
- keep `POLYON_APPROVAL_MODE=ASK_EVERYTHING` during initial validation;
- place public-facing deployments behind HTTPS and an appropriate reverse proxy;
- keep model, integration, SMTP, and other credentials server-side;
- use explicit research and semantic-indexing allowlists;
- protect and back up the persistent POLYON data directory.
