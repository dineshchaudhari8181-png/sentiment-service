## Slack Sentiment Service

Standalone Express service that powers the Slack “Sentiment Score” message shortcut. It listens for `/api/slack/sentiment`, opens a loading modal, fetches the message thread, runs Node.js sentiment analysis (with optional Gemini fallback), and then updates the modal with the results. Nothing is persisted – all analysis is computed on demand.

### Prerequisites

- Node.js 18+
- A Slack app with Interactivity enabled and a message shortcut pointing to this service
- Slack scopes: `commands`, `chat:write`, `conversations.history`, `conversations.replies`, `reactions:read`, `views:write`
- Optional: Google Gemini API key if you want the fallback sentiment scoring (a practice key/model are already hardcoded in `src/config.js`, but you should override them with your own for real projects)

### Setup

```bash
cd sentiment-service
cp env.example .env   # fill in tokens & keys
npm install
npm run dev           # or npm start
```

Expose the service with something like `ngrok http 3000` while developing, and configure the Slack shortcut URL to `https://<your-domain>/api/slack/sentiment`.

### Deployment

- Create a new Render service (or similar host) pointing to this folder/repo
- Set the environment variables from `.env`
- Update the Slack shortcut Request URL to the deployed `/api/slack/sentiment` endpoint

### Environment Variables

- `PORT` – defaults to 3000
- `SLACK_BOT_TOKEN` – Bot token (xoxb-…)
- `SLACK_SIGNING_SECRET` – Slack signing secret
- `GEMINI_API_KEY` – (Optional) Google Gemini API key
- `GEMINI_MODEL` – (Optional) model name, defaults to `gemini-2.5-flash`

### Notes

- The main project you already have keeps its integrated sentiment feature. This repo is simply a standalone version so you can deploy/maintain it separately.
- All sentiment calculations happen in memory; no database is required.

