# 0003 — Approval signal: `/adt-approve` comment OR PR Approve event

A task advances from `design` to `impl` (and similarly any future stage that needs user approval) when **either**:
- The Issue or PR receives a comment whose body matches `^/adt-approve(\s.*)?$` (case-insensitive), authored by anyone (the user, a teammate, a collaborator); **or**
- GitHub records a PR review with `state = APPROVED` on the design PR, from anyone.

Either signal flips the stage. We deliberately accept ambiguity here (a teammate approving on the user's behalf is fine) because the alternative — restricting approval to the Issue author — makes the team less useful in repos with multiple trusted collaborators and adds complexity for little benefit.误推进 (误识别) 的成本低于误阻塞(用户忘了敲魔法命令)。

The same signals apply to any other approval-gated transition (none in v1 besides design).