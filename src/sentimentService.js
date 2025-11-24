const Sentiment = require('sentiment');
const emojiSentimentDataset = require('emoji-sentiment');
const emoji = require('node-emoji');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { slackClient } = require('./slackClient');
const config = require('./config');

const sentimentEngine = new Sentiment();

const emojiScoreMap = new Map(
  emojiSentimentDataset.map((entry) => {
    const codePoints = entry.sequence.split('-').map((value) => parseInt(value, 16));
    const emojiChar = String.fromCodePoint(...codePoints);
    return [emojiChar, entry.score];
  })
);

const REACTION_ALIAS = {
  thumbsup: '👍',
  thumbsdown: '👎',
  '+1': '👍',
  '-1': '👎',
};

function getEmojiCharacterFromReaction(name = '') {
  if (!name) return null;
  const normalized = name.toLowerCase();
  const baseName = normalized.split('::')[0];
  return emoji.get(baseName) || REACTION_ALIAS[baseName] || null;
}

function getReactionSentimentDelta(name, count = 0) {
  const emojiChar = getEmojiCharacterFromReaction(name);
  if (!emojiChar) return 0;

  const score = emojiScoreMap.get(emojiChar);
  if (typeof score !== 'number') return 0;

  return score * count;
}

function trimText(text = '', max = 120) {
  const normalized = text.trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function formatUser(userId) {
  return userId ? `<@${userId}>` : 'Someone';
}

function classifyMood(score) {
  if (score >= 3) return { label: 'Positive', emoji: '😄' };
  if (score <= -3) return { label: 'Negative', emoji: '😟' };
  return { label: 'Neutral', emoji: '😐' };
}

function summarizeReactions(reactions = []) {
  if (!Array.isArray(reactions) || reactions.length === 0) {
    return { reactionScore: 0, summaryText: 'No reactions yet.' };
  }

  let reactionScore = 0;
  const summaryParts = reactions.slice(0, 8).map((reaction) => {
    const name = reaction.name || 'reaction';
    const count = reaction.count || 0;
    reactionScore += getReactionSentimentDelta(name, count);
    return `:${name}: ×${count}`;
  });

  return { reactionScore, summaryText: summaryParts.join(' • ') };
}

let geminiClient = null;
if (config.geminiApiKey) {
  try {
    geminiClient = new GoogleGenerativeAI(config.geminiApiKey);
  } catch (error) {
    console.warn('⚠️  Gemini initialization failed:', error.message);
  }
}

async function analyzeWithGemini(text, context = '', modelName) {
  if (!geminiClient) return 0;

  try {
    const model = geminiClient.getGenerativeModel({ model: modelName });
    const prompt = `Analyze the sentiment of this message and return ONLY a number from -3 to +3:
- +3 = Very positive
- +2 = Positive
- +1 = Slightly positive
- 0 = Neutral
- -1 = Slightly negative
- -2 = Negative
- -3 = Very negative

${context ? `Context:\n${context}\n\n` : ''}Message: "${text}"

Return ONLY the number, nothing else.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const geminiText = response.text().trim();
    const score = parseFloat(geminiText);
    if (Number.isNaN(score)) {
      console.warn(`⚠️  Gemini returned non-numeric value "${geminiText}"`);
      return 0;
    }
    return Math.max(-3, Math.min(3, score));
  } catch (error) {
    console.warn(`⚠️  Gemini model "${modelName}" failed: ${error.message}`);
    throw error;
  }
}

async function analyzeThreadSentiment(messages = [], reactions = []) {
  const messageAnalyses = [];
  let textScore = 0;

  const context = messages.map((m) => m?.text?.trim()).filter(Boolean).join(' ').slice(0, 500);

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const text = message?.text?.trim();
    if (!text) continue;

    const result = sentimentEngine.analyze(text);
    let finalScore = result.score;
    let usedGemini = false;

    if (finalScore === 0 && geminiClient) {
      const modelsToTry = [
        config.geminiModel,
        'gemini-2.5-flash',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-pro',
      ].filter((model, idx, arr) => model && arr.indexOf(model) === idx);

      for (const modelName of modelsToTry) {
        try {
          const geminiScore = await analyzeWithGemini(text, context, modelName);
          if (geminiScore !== 0) {
            finalScore = geminiScore;
            usedGemini = true;
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }

    textScore += finalScore;

    messageAnalyses.push({
      ts: message.ts,
      text,
      snippet: trimText(text, 120),
      score: finalScore,
      userId: message.user,
      isRoot: message.thread_ts ? message.ts === message.thread_ts : false,
      usedGemini,
    });
  }

  const { reactionScore, summaryText } = summarizeReactions(reactions);
  const combinedScore = textScore + reactionScore;
  const mood = classifyMood(combinedScore);

  return {
    textScore,
    reactionScore,
    combinedScore,
    mood,
    reactionSummaryText: summaryText,
    messageAnalyses,
    analyzedMessageCount: messageAnalyses.length,
  };
}

async function fetchThreadMessages(channelId, rootTs) {
  const response = await slackClient.conversations.replies({
    channel: channelId,
    ts: rootTs,
    inclusive: true,
    limit: 50,
  });
  return response.messages || [];
}

async function fetchRootReactions(channelId, rootTs) {
  try {
    const response = await slackClient.reactions.get({
      channel: channelId,
      timestamp: rootTs,
      full: true,
    });
    return response?.message?.reactions || [];
  } catch (error) {
    console.warn('⚠️  Unable to fetch reactions for sentiment modal:', error.message);
    return [];
  }
}

function buildLoadingView(rootMessage) {
  return {
    type: 'modal',
    callback_id: 'sentiment_score_loading',
    title: { type: 'plain_text', text: 'Sentiment Score' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Analyzing conversation...*' },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Message snippet:\n>${trimText(rootMessage.text, 120)}` }],
      },
    ],
  };
}

function buildResultView(rootMessage, analysis) {
  const { mood, combinedScore, textScore, reactionScore, reactionSummaryText, analyzedMessageCount } = analysis;

  return {
    type: 'modal',
    callback_id: 'sentiment_score_result',
    title: { type: 'plain_text', text: 'Sentiment Score' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${mood.emoji} *Overall mood:* ${mood.label}\n*Combined score:* ${combinedScore.toFixed(1)}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${analyzedMessageCount} messages analyzed • Text score: ${textScore.toFixed(
              1
            )} • Reaction adj: ${reactionScore >= 0 ? `+${reactionScore.toFixed(1)}` : reactionScore.toFixed(1)}`,
          },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Message preview*\n${trimText(rootMessage.text, 180)}` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Posted by ${formatUser(rootMessage.userId)} in <#${rootMessage.channelId}>` }],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Reactions overview*\n${reactionSummaryText}` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '🔒 Sentiment is calculated on demand and not stored anywhere.' }],
      },
    ],
  };
}

function buildErrorView(errorMessage, rootMessage) {
  return {
    type: 'modal',
    callback_id: 'sentiment_score_error',
    title: { type: 'plain_text', text: 'Sentiment Score' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '⚠️ *Unable to calculate sentiment right now.*' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `Reason: \`${errorMessage}\`` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Original message: ${trimText(rootMessage.text, 120)}` }],
      },
    ],
  };
}

async function handleSentimentShortcut(payload) {
  if (!payload) throw new Error('Missing Slack payload.');

  const triggerId = payload.trigger_id;
  const channelId = payload.channel?.id || payload.message?.channel;
  const rootTs = payload.message?.thread_ts || payload.message?.ts;
  const rootMessage = {
    text: payload.message?.text || 'No text content',
    userId: payload.message?.user,
    channelId,
  };

  if (!triggerId || !channelId || !rootTs) {
    throw new Error('Slack payload missing trigger_id, channel, or message timestamp.');
  }

  const loadingView = buildLoadingView(rootMessage);
  const openedView = await slackClient.views.open({ trigger_id: triggerId, view: loadingView });
  const viewId = openedView?.view?.id;
  const viewHash = openedView?.view?.hash;

  try {
    const [threadMessages, reactions] = await Promise.all([
      fetchThreadMessages(channelId, rootTs),
      fetchRootReactions(channelId, rootTs),
    ]);

    if (!threadMessages.length) {
      throw new Error('Unable to read conversation messages (is the bot in the channel?)');
    }

    const analysis = await analyzeThreadSentiment(threadMessages, reactions);
    const resultView = buildResultView(rootMessage, analysis);

    if (viewId) {
      await slackClient.views.update({ view_id: viewId, hash: viewHash, view: resultView });
    } else {
      await slackClient.views.open({ trigger_id: triggerId, view: resultView });
    }
  } catch (error) {
    console.error('❌ Sentiment analysis failed:', error);
    const errorView = buildErrorView(error.message, rootMessage);
    if (viewId) {
      await slackClient.views.update({ view_id: viewId, hash: viewHash, view: errorView });
    } else {
      await slackClient.views.open({ trigger_id: triggerId, view: errorView });
    }
  }
}

module.exports = { handleSentimentShortcut };

