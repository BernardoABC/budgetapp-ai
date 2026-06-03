# Git & Developer Workflow

This document covers branching conventions, commit style, and the PR process for this project.

> This is a teaching project. The goal is not just to ship features — it's to practice professional engineering habits.

---

## Branching

Use the branch name that Linear generates for your issue. It will look like:

```
bernardobonillac/crcusd-10-11-a-initialize-go-server-with-podman-compose
```

Never commit directly to `main`. All work goes through a branch and a pull request.

```bash
git checkout -b <linear-generated-branch-name>
```

---

## Commit messages

Write commit messages in the imperative mood — describe what the commit *does*, not what you *did*.

**Good:**
```
Add Chi router and health check endpoint
Initialize pgx connection pool with configurable limits
```

**Avoid:**
```
added router
fixed stuff
wip
```

Keep the subject line under 72 characters. If you need more context, add a blank line after the subject and write a short paragraph explaining *why*.

---

## Pull requests

- Multiple PRs per Linear issues is fine
- Link the PR to the issue (GitHub will auto-link if the branch name contains the issue ID)
- Keep PRs small and focused — a reviewer should be able to understand the change in one sitting
- PR description should explain **what** changed and **why**, not just repeat the commit messages

### PR checklist before requesting review

- [ ] The app still starts (`podman compose up` works)
- [ ] No hardcoded credentials or `.env` values committed
- [ ] No `float64` used for monetary values
- [ ] Code formatted (`gofmt ./...` for Go, `prettier --check` for frontend)

---

## Code review

- Review comments are about the code, not the person
- If you disagree with a comment, discuss it — don't just silently comply or ignore
- Approve only when you'd be comfortable owning the code yourself

---

## Key rules

| Rule | Why |
|------|-----|
| No commits to `main` | Protects the stable baseline everyone builds on |
| No `float64` for money | Floating-point arithmetic is imprecise; we use `int64` centimos |
| No secrets in the repo | Real `.env` values must never be committed — use `.env.example` |
| Migrations are append-only | Never edit a migration that has already been applied to any environment |
