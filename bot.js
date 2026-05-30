const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Parser = require('rss-parser');

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID,

  // On startup, skip articles older than this many minutes
  MAX_ARTICLE_AGE_MINUTES: 10,

  KEYWORDS: [
    // Trump / Political
    'Trump stock', 'Trump buys', 'Trump Truth Social', 'Trump mentions',
    'Trump endorses', 'Trump praises', 'Trump pumps', 'Trump bought shares',
    'Trump stock trade', 'Trump financial disclosure', 'Trump endorsement stock',
    'White House stock', 'presidential stock', 'Palantir Trump', 'Dell Trump',
    'Intel Trump', 'Micron Trump', 'Apple Trump', 'Thermo Fisher Trump',

    // Ticker symbols
    '$PLTR', '$DELL', '$INTC', '$MU', '$NVDA', '$ORCL', '$TMO', '$AAPL',

    // Market moving events
    'unusual options activity', 'insider buying', 'insider selling',
    'short squeeze', 'merger', 'acquisition', 'buyout',
    'earnings beat', 'earnings miss', 'SEC investigation', 'bankruptcy',
    'stock halted', 'secondary offering', 'share buyback', 'class action lawsuit',
    'FDA approval', 'FDA rejection', 'FOMC', 'rate decision', 'Fed rate',
  ],

  CHECK_INTERVAL_MS: 1 * 5 * 1000, // every 2 minutes

  RSS_FEEDS: [
    { name: 'Reuters Business',    url: 'https://feeds.reuters.com/reuters/businessNews' },
    { name: 'CNBC',                url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
    { name: 'Bloomberg Markets',   url: 'https://feeds.bloomberg.com/markets/news.rss' },
    { name: 'MarketWatch',         url: 'https://feeds.marketwatch.com/marketwatch/topstories/' },
    { name: 'Yahoo Finance',       url: 'https://finance.yahoo.com/news/rssindex' },
    { name: 'Unusual Whales',      url: 'https://unusualwhales.com/rss/news' },
    { name: 'Politico',            url: 'https://www.politico.com/rss/politics08.xml' },
    { name: 'The Hill',            url: 'https://thehill.com/rss/syndicator/19109' },
    { name: 'Axios',               url: 'https://api.axios.com/feed/' },
    { name: 'WSJ Markets',         url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines' },
    { name: 'Seeking Alpha',       url: 'https://seekingalpha.com/market_currents.xml' },
    { name: 'Investopedia',        url: 'https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline' },
    { name: 'Barrons',             url: 'https://www.barrons.com/xml/rss/3_7014.xml' },
    { name: 'AP Business',         url: 'https://rsshub.app/apnews/topics/apf-business' },
    { name: 'NPR Politics',        url: 'https://feeds.npr.org/1014/rss.xml' },
    { name: 'Quiver Quantitative', url: 'https://www.quiverquant.com/news/rss' },
    { name: 'Capitol Trades',      url: 'https://www.capitoltrades.com/rss' },
    { name: 'SEC EDGAR 8-K',       url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&output=atom' },
  ],
};
// ============================================================

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const parser = new Parser();
const seenArticles = new Set();
let alertChannel = null;
let isFirstRun = true;

// ── Age check — skips old articles on startup ────────────────
function isArticleTooOld(item) {
  if (!item.pubDate) return false;
  const ageMinutes = (Date.now() - new Date(item.pubDate).getTime()) / 1000 / 60;
  if (isFirstRun) return ageMinutes > CONFIG.MAX_ARTICLE_AGE_MINUTES;
  return ageMinutes > 60 * 24;
}

// ── Keyword match ────────────────────────────────────────────
function articleMatchesKeywords(article) {
  const text = `${article.title || ''} ${article.contentSnippet || ''}`.toLowerCase();
  return CONFIG.KEYWORDS.find(kw => text.includes(kw.toLowerCase()));
}

// ── Check one feed ───────────────────────────────────────────
async function checkFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    for (const item of parsed.items) {
      if (seenArticles.has(item.link)) continue;
      seenArticles.add(item.link);

      if (isArticleTooOld(item)) {
        console.log(`[SKIP] Too old: ${item.title?.slice(0, 60)}`);
        continue;
      }

      const matchedKeyword = articleMatchesKeywords(item);
      if (!matchedKeyword) continue;

      const embed = new EmbedBuilder()
        .setColor(0xFF4500)
        .setTitle(item.title || 'News Alert')
        .setURL(item.link)
        .setDescription(item.contentSnippet?.slice(0, 300) + '...' || 'Click to read more.')
        .addFields(
          { name: '🔍 Matched Keyword', value: `\`${matchedKeyword}\``, inline: true },
          { name: '📰 Source',          value: feed.name,               inline: true },
          { name: '🕐 Published',       value: item.pubDate ? new Date(item.pubDate).toLocaleString() : 'Unknown', inline: true },
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

// ── Main loop ────────────────────────────────────────────────
async function runChecks() {
  console.log(`[${new Date().toLocaleTimeString()}] Checking ${CONFIG.RSS_FEEDS.length} feeds...${isFirstRun ? ' (first run — skipping old articles)' : ''}`);
  await Promise.allSettled(CONFIG.RSS_FEEDS.map(feed => checkFeed(feed)));
  isFirstRun = false;
}

// ── Bot ready ────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  alertChannel = await client.channels.fetch(CONFIG.CHANNEL_ID);
  if (!alertChannel) {
    console.error('❌ Could not find channel. Check CHANNEL_ID in config.');
    process.exit(1);
  }

  console.log(`📡 Monitoring channel: #${alertChannel.name}`);
  console.log(`⏱️  Checking every ${CONFIG.CHECK_INTERVAL_MS / 1000}s`);
  console.log(`🕐 Skipping articles older than ${CONFIG.MAX_ARTICLE_AGE_MINUTES} min on startup\n`);

  await alertChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🟢 News Alert Bot Online')
        .setDescription(
          `Monitoring **${CONFIG.RSS_FEEDS.length} feeds** for **${CONFIG.KEYWORDS.length} keywords**\n` +
          `🕐 Skipping articles older than **${CONFIG.MAX_ARTICLE_AGE_MINUTES} minutes** on startup`
        )
        .addFields({ name: 'Keywords', value: CONFIG.KEYWORDS.map(k => `\`${k}\``).join(', ') })
        .setTimestamp()
    ]
  });

  await runChecks();
  setInterval(runChecks, CONFIG.CHECK_INTERVAL_MS);
});

client.login(CONFIG.DISCORD_TOKEN);
