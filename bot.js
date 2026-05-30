const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Parser = require('rss-parser');
const http = require('http');

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID,

  MAX_ARTICLE_AGE_MINUTES: 10,
  MAX_SEEN_ARTICLES: 2000,
  KEEP_ALIVE_PORT: process.env.PORT || 3000,

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

  CHECK_INTERVAL_MS: 2 * 60 * 1000,

  // Only feeds confirmed to work without blocking bots
  RSS_FEEDS: [
    // Google News proxies (bypasses bot blocking on major outlets)
    { name: 'Reuters',         url: 'https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com+business&ceid=US:en&hl=en-US&gl=US' },
    { name: 'Politico',        url: 'https://news.google.com/rss/search?q=when:24h+allinurl:politico.com+stock&ceid=US:en&hl=en-US&gl=US' },
    { name: 'Barrons',         url: 'https://news.google.com/rss/search?q=when:24h+allinurl:barrons.com&ceid=US:en&hl=en-US&gl=US' },
    { name: 'WSJ',             url: 'https://news.google.com/rss/search?q=when:24h+allinurl:wsj.com+markets&ceid=US:en&hl=en-US&gl=US' },
    { name: 'Bloomberg',       url: 'https://news.google.com/rss/search?q=when:24h+allinurl:bloomberg.com+markets&ceid=US:en&hl=en-US&gl=US' },
    { name: 'CNBC Markets',    url: 'https://news.google.com/rss/search?q=when:24h+allinurl:cnbc.com+markets&ceid=US:en&hl=en-US&gl=US' },

    // Direct RSS feeds that work reliably
    { name: 'CNBC',            url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
    { name: 'MarketWatch',     url: 'https://feeds.marketwatch.com/marketwatch/topstories/' },
    { name: 'Yahoo Finance',   url: 'https://finance.yahoo.com/news/rssindex' },
    { name: 'Benzinga',        url: 'https://www.benzinga.com/feed' },
    { name: 'TheStreet',       url: 'https://www.thestreet.com/rss/index.xml' },
    { name: 'Seeking Alpha',   url: 'https://seekingalpha.com/market_currents.xml' },
    { name: 'The Hill',        url: 'https://thehill.com/rss/syndicator/19109' },
    { name: 'Axios',           url: 'https://api.axios.com/feed/' },
    { name: 'AP Business',     url: 'https://feeds.apnews.com/rss/business' },
    { name: 'NPR Politics',    url: 'https://feeds.npr.org/1014/rss.xml' },
    { name: 'FT Markets',      url: 'https://www.ft.com/markets?format=rss' },
    { name: 'WashPost Markets',url: 'https://feeds.washingtonpost.com/rss/business/economy' },
    { name: 'SEC News',        url: 'https://www.sec.gov/rss/news/press.rss' },
  ],
};
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});
const parser = new Parser();
const seenArticles = new Set();
let alertChannel = null;
let isFirstRun = true;

// ── Keep-alive web server ────────────────────────────────────
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running');
}).listen(CONFIG.KEEP_ALIVE_PORT, () => {
  console.log(`🌐 Keep-alive server on port ${CONFIG.KEEP_ALIVE_PORT}`);
});

// ── Capped seen-articles set ─────────────────────────────────
function addSeen(url) {
  if (seenArticles.size >= CONFIG.MAX_SEEN_ARTICLES) {
    const first = seenArticles.values().next().value;
    seenArticles.delete(first);
  }
  seenArticles.add(url);
}

// ── Age check ────────────────────────────────────────────────
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
      addSeen(item.link);

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
      console.log(`[ALERT] "${matchedKeyword}" | ${feed.name} | ${item.title}`);
    }
  } catch (err) {
    console.error(`[ERROR] Failed to fetch ${feed.name}: ${err.message}`);
  }
}

// ── Main loop ────────────────────────────────────────────────
async function runChecks() {
  console.log(`[${new Date().toLocaleTimeString()}] Checking ${CONFIG.RSS_FEEDS.length} feeds... (${seenArticles.size}/${CONFIG.MAX_SEEN_ARTICLES} tracked)`);
  await Promise.allSettled(CONFIG.RSS_FEEDS.map(feed => checkFeed(feed)));
  isFirstRun = false;
}

// ── Bot ready ────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    alertChannel = await client.channels.fetch(CONFIG.CHANNEL_ID);
  } catch (err) {
    console.error('❌ Could not find channel:', err.message);
    process.exit(1);
  }

  console.log(`📡 Monitoring: #${alertChannel.name}`);
  console.log(`⏱️  Every ${CONFIG.CHECK_INTERVAL_MS / 1000}s | Skipping articles older than ${CONFIG.MAX_ARTICLE_AGE_MINUTES}min on startup\n`);

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
