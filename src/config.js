const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env'),
});

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const DEFAULT_GEMINI_API_KEY = 'AIzaSyDL5e19t9f7ycImfqw3l5PSVZ5KDAAJTUk';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const config = {
  port: toNumber(process.env.PORT, 3000),
  slackBotToken: process.env.SLACK_BOT_TOKEN || '',
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET || '',
  // Fallback to built-in practice credentials if env vars are not provided
  geminiApiKey: process.env.GEMINI_API_KEY || DEFAULT_GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
};

module.exports = config;

