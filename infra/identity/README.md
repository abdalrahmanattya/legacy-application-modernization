# GitHub OIDC identity (separately managed, plan-only)

This module is intentionally separate from application state. It creates a
GitHub OIDC provider and distinct read-only plan/apply roles, constrained by
owner, repository, audience, main branch/pull-request subject, and protected
environment. The plan role only has read-only discovery permissions. The apply
role requires a protected environment claim and has an explicit deployment
policy, but the repository workflow remains hard-disabled until the role,
protected environment, backend state, and least-privilege boundary are
separately reviewed. Cognito creates no users and no client secret; the public
client is a public no-secret client with no localhost callback; resource-server
scopes are metadata until the application explicitly enforces them. No role or
identity resource is applied by this project.
