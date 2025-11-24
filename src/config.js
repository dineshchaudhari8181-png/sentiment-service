const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env'),
});

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const config = {
  port: toNumber(process.env.PORT, 3000),
  slackBotToken: process.env.SLACK_BOT_TOKEN || '',
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
};

module.exports = config;

