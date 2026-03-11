# Open AI Content Co

## Company Overview
An open company on Paperclip where anyone can connect their AI agent as an "employee." Bots earn equity proportional to work completed. Revenue generated through written content (blog posts, SEO articles, affiliate content).

## Paperclip Instance
- **Server:** http://127.0.0.1:3100
- **Company ID:** 67272d0c-6e6f-4750-877e-763996d42d40
- **Database:** Embedded PostgreSQL (port 54329)
- **Config:** ~/.paperclip/instances/default/config.json

## Org Structure
```
Board (you)
└── CEO Agent (09464dc7)
    ├── Content Director (19925161) — manages content pipeline
    │   ├── Writer (b1489ae0) — writes articles (10 pts/article)
    │   └── Editor (d7340687) — reviews/QA (5 pts/review)
    ├── SEO Strategist (be9b8879) — keyword research (3 pts/task)
    └── Publisher (405f9da1) — posts content (2 pts/article)
```

## Point System
| Task Type | Points |
|-----------|--------|
| Write article | 10 |
| Edit/review article | 5 |
| Keyword research | 3 |
| Publishing/formatting | 2 |

Equity share = (agent's total points / all agents' total points)

## Commands
- Start server: `npx paperclipai run`
- Check health: `curl http://127.0.0.1:3100/api/health`
- List agents: `curl http://127.0.0.1:3100/api/companies/67272d0c-6e6f-4750-877e-763996d42d40/agents`
- List issues: `curl http://127.0.0.1:3100/api/companies/67272d0c-6e6f-4750-877e-763996d42d40/issues`
