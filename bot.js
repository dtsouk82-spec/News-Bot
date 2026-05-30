const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Parser = require('rss-parser');

// ============================================================
// CONFIGURATION — edit these before running
// ============================================================
const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID,

  // Add or remove keywords (case-insensitive)
  KEYWORDS: [
    'Trump stock',
    'Trump buys',
    'Trump Truth Social',
    'Trump mentions',
    'Trump endorses',
    'Palantir Trump',
    'Dell Trump',
    'Oracle Trump',
    'Trump stock trade',
    'Trump financial disclosure',
    'presidential stock',
    'Trump praises',
    'Trump pumps',
    'Trump endorsement stock',
    'White House stock',
    'Trump bought shares',
  ],

  // How often to check for new articles (milliseconds)
  CHECK_INTERVAL_MS: 1 * 15 * 1000, // every 30 seconds

  // News RSS feeds to monitor
  RSS_FEEDS: [
    { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews' },
    { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
    { name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss' },
    { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/' },
    { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },
    { name: 'Unusual Whales', url: 'https://unusualwhales.com/rss/news' },
    { name: 'Politico', url: 'https://www.politico.com/rss/politics08.xml' },
    { name: 'The Hill', url: 'https://thehill.com/rss/syndicator/19109' },
    { name: 'Axios', url: 'https://api.axios.com/feed/' },
    { name: 'WSJ Markets', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines' },
    { name: 'Seeking Alpha', url: 'https://seekingalpha.com/market_currents.xml' },
    { name: 'Investopedia', url: 'https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline' },
    { name: 'Barrons', url: 'https://www.barrons.com/xml/rss/3_7014.xml' },
    { name: 'AP Business', url: 'https://rsshub.app/apnews/topics/apf-business' },
    { name: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml' },
    { name: 'Quiver Quantitative', url: 'https://www.quiverquant.com/news/rss' },
    { name: 'Capitol Trades', url: 'https://www.capitoltrades.com/rss' },
  ],
};
// ============================================================

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const parser = new Parser();

// Track already-seen articles so we don't double-post
const seenArticles = new Set();
let alertChannel = null;

function articleMatchesKeywords(article) {
  const text = `${article.title || ''} ${article.contentSnippet || ''}`.toLowerCase();
  return CONFIG.KEYWORDS.find(kw => text.includes(kw.toLowerCase()));
}

async function checkFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    for (const item of parsed.items) {
      if (seenArticles.has(item.link)) continue;
      seenArticles.add(item.link);

      const matchedKeyword = articleMatchesKeywords(item);
      if (!matchedKeyword) continue;

      const embed = new EmbedBuilder()
        .setColor(0xFF4500)
        .setTitle(item.title || 'News Alert')
        .setURL(item.link)
        .setDescription(item.contentSnippet?.slice(0, 300) + '...' || 'Click to read more.')
        .addFields(
          { name: '🔍 Matched Keyword', value: `\`${matchedKeyword}\``, inline: true },
          { name: '📰 Source', value: feed.name, inline: true },
          { name: '🕐 Published', value: item.pubDate ? new Date(item.pubDate).toLocaleString() : 'Unknown', inline: true }
        )
        .setFooter({ text: 'News Alert Bot • Real-time monitoring' })
        .setTimestamp();

      await alertChannel.send({ embeds: [embed] });
      console.log(`[ALERT] Matched "${matchedKeyword}" in: ${item.title}`);
    }
  } catch (err) {
    console.error(`[ERROR] Failed to fetch ${feed.name}: ${err.message}`);
  }
}

async function runChecks() {
  console.log(`[${new Date().toLocaleTimeString()}] Checking ${CONFIG.RSS_FEEDS.length} feeds...`);
  await Promise.allSettled(CONFIG.RSS_FEEDS.map(feed => checkFeed(feed)));
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  alertChannel = await client.channels.fetch(CONFIG.CHANNEL_ID);
  if (!alertChannel) {
    console.error('❌ Could not find channel. Check CHANNEL_ID in config.');
    process.exit(1);
  }

  console.log(`📡 Monitoring channel: #${alertChannel.name}`);
  console.log(`🔍 Keywords: ${CONFIG.KEYWORDS.join(', ')}`);
  console.log(`⏱️  Checking every ${CONFIG.CHECK_INTERVAL_MS / 1000}s\n`);

  // Send startup message
  await alertChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🟢 Ron Burgundy Clocking In')
        .setDescription(`Monitoring **${CONFIG.RSS_FEEDS.length} feeds** for **${CONFIG.KEYWORDS.length} keywords**`)
        .addFields({ name: 'Keywords', value: CONFIG.KEYWORDS.map(k => `\`${k}\``).join(', ') })
        .setTimestamp()
    ]
  });

  // Run immediately, then on interval
  await runChecks();
  setInterval(runChecks, CONFIG.CHECK_INTERVAL_MS);
});

client.login(CONFIG.DISCORD_TOKEN);
