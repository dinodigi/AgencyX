# AgencyX — Project Management

How we run the build. Lightweight on purpose: three files and a sprint folder.

| File | What it holds |
|---|---|
| [`BACKLOG.md`](BACKLOG.md) | Every open task, with an ID, owner and size. The single source of "what's left". |
| [`SHIPPED.md`](SHIPPED.md) | Done log — what landed, when, and what proved it. |
| [`sprints/`](sprints/) | One file per sprint: goal, committed tasks, daily notes, retro. |

Longer-form context lives elsewhere and is **not** duplicated here:
`POST-DEPLOY.md` (current workstream design), `roadmap.md` (phases/milestones),
`lead-engine-build-brief.md` (the original spec), `DEPLOY.md` (ops).
The backlog links to them; it doesn't restate them.

---

## How we work

**Sprint length:** 1 week. Monday → Sunday.

**Sprint ritual (~15 min, start of sprint):**
1. Read the previous sprint's retro.
2. Pick a **single sprint goal** — one sentence, the thing that must be true by Sunday.
3. Pull tasks from `BACKLOG.md` that serve the goal. Anything else is stretch.
4. Copy `sprints/TEMPLATE.md` → `sprints/sprint-NN.md` and fill it in.

**During the sprint:** update the task's status in the sprint file as you go.
When a task is done, move its line to `SHIPPED.md` with the commit SHA and
delete it from `BACKLOG.md`.

**End of sprint:** write the retro (3 lines is fine), roll incomplete tasks
back into `BACKLOG.md`, and note *why* they slipped.

---

## Task conventions

**ID:** `AX-###`, allocated sequentially, never reused. Reference it in commit
messages (`AX-006: tune Maps deep re-scrape lookup`) so history is traceable.

**Status:**

| Status | Meaning |
|---|---|
| `todo` | Not started |
| `doing` | In progress right now |
| `blocked` | Waiting on something external — the blocker must be named |
| `review` | Built, awaiting live proof or a decision |
| `done` | Landed **and verified**; move to `SHIPPED.md` |

**Size:** `S` (< half a day) · `M` (1–2 days) · `L` (3+ days — consider splitting).

**Owner:** `claude` (I can do it unattended) or `dino` (needs your hands —
credentials, dashboards, purchases, anything behind a login I can't touch).

**Definition of done:** code merged to `main`, typecheck + tests green, and —
for anything touching the live pipeline — **proven on a real run**, not just
built. This project has burned time on "built but never clicked" before; a task
sitting in `review` is not done.
