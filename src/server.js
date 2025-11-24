const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const config = require('./config');
const { handleSentimentShortcut } = require('./sentimentService');

const app = express();

const rawBodySaver = (req, res, buf) => {
  if (buf?.length) {
    req.rawBody = buf.toString('utf8');
  }
};

app.use(
  bodyParser.json({
    verify: rawBodySaver,
  })
);

function verifySlackSignature(req, res, next) {
  if (!config.slackSigningSecret) {
    return next();
  }

  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];

  if (!signature || !timestamp) {
    return res.status(400).send('Missing Slack signature headers.');
  }

  const ts = Number(timestamp);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    return res.status(400).send('Stale Slack request.');
  }

  const hmac = crypto.createHmac('sha256', config.slackSigningSecret);
  const base = `v0:${timestamp}:${req.rawBody || ''}`;
  hmac.update(base);
  const computed = `v0=${hmac.digest('hex')}`;

  if (!crypto.timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(signature, 'utf8'))) {
    return res.status(400).send('Invalid Slack signature.');
  }

  return next();
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Sentiment service running.' });
});

app.post('/api/slack/sentiment', bodyParser.urlencoded({ extended: true }), verifySlackSignature, async (req, res) => {
  const { payload } = req.body || {};

  if (!payload) {
    return res.status(400).send('Missing Slack payload.');
  }

  let actionPayload;
  try {
    actionPayload = JSON.parse(payload);
  } catch (error) {
    console.error('❌ Invalid Slack shortcut payload:', error);
    return res.status(400).send('Invalid Slack payload.');
  }

  res.status(200).send();

  try {
    await handleSentimentShortcut(actionPayload);
  } catch (error) {
    console.error('❌ Failed to process sentiment shortcut:', error);
  }
});

app.listen(config.port, () => {
  console.log(`🚀 Sentiment service running on http://localhost:${config.port}`);
});

