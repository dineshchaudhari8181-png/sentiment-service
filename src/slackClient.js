const { WebClient } = require('@slack/web-api');
const config = require('./config');

if (!config.slackBotToken) {
  console.warn('⚠️  SLACK_BOT_TOKEN is not set. Slack API calls will fail.');
}

const slackClient = new WebClient(config.slackBotToken || '');

module.exports = { slackClient };

