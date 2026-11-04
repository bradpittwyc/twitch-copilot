/**
 * Twitch English Copilot - lib.js
 * Pure utility functions for Twitch IRC parsing, channel normalization,
 * message formatting, Gemini translation batching, and reply suggestion generation.
 *
 * Compatible with both Browser (window.Lib) and Node.js (module.exports).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js
    module.exports = factory();
  } else {
    // Browser
    root.Lib = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Unescape IRCv3 tag value
   * Escapes handled:
   *  \: -> ;
   *  \s -> space
   *  \\ -> \
   *  \r -> CR
   *  \n -> LF
   */
  function unescapeTagValue(val) {
    if (!val || typeof val !== 'string') return '';
    return val.replace(/\\([:s\\rn])/g, function (_, char) {
      switch (char) {
        case ':': return ';';
        case 's': return ' ';
        case '\\': return '\\';
        case 'r': return '\r';
        case 'n': return '\n';
        default: return char;
      }
    });
  }

  /**
   * Parse Twitch IRC tags into an object key-value map.
   * e.g. "@color=#0000FF;display-name=WyC;mod=0"
   */
  function parseIrcTags(tagString) {
    const tags = {};
    if (!tagString || typeof tagString !== 'string') return tags;

    const clean = tagString.startsWith('@') ? tagString.slice(1) : tagString;
    if (!clean) return tags;

    const parts = clean.split(';');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) {
        tags[part] = '';
      } else {
        const key = part.slice(0, eqIndex);
        const val = part.slice(eqIndex + 1);
        tags[key] = unescapeTagValue(val);
      }
    }
    return tags;
  }

  /**
   * Parse a raw Twitch IRC PRIVMSG line.
   * Returns parsed message object or null if not a PRIVMSG.
   */
  function parsePrivmsg(rawLine) {
    if (!rawLine || typeof rawLine !== 'string') return null;

    const trimmed = rawLine.trim();
    if (!trimmed.includes('PRIVMSG')) return null;

    let line = trimmed;
    let tags = {};

    // 1. Tags prefix (@...)
    if (line.startsWith('@')) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return null;
      tags = parseIrcTags(line.slice(1, spaceIdx));
      line = line.slice(spaceIdx + 1).trimStart();
    }

    // 2. Prefix (:nick!user@host)
    let prefix = '';
    if (line.startsWith(':')) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return null;
      prefix = line.slice(1, spaceIdx);
      line = line.slice(spaceIdx + 1).trimStart();
    }

    // 3. Command and channel
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) return null;
    const command = line.slice(0, spaceIdx);
    if (command !== 'PRIVMSG') return null;

    const rest = line.slice(spaceIdx + 1).trimStart();
    const colonIdx = rest.indexOf(' :');
    let rawChannel = '';
    let text = '';

    if (colonIdx !== -1) {
      rawChannel = rest.slice(0, colonIdx).trim();
      text = rest.slice(colonIdx + 2);
    } else {
      // Message without leading space-colon
      const nextSpace = rest.indexOf(' ');
      if (nextSpace !== -1) {
        rawChannel = rest.slice(0, nextSpace).trim();
        text = rest.slice(nextSpace + 1).replace(/^:/, '');
      } else {
        rawChannel = rest;
        text = '';
      }
    }

    const channel = rawChannel.startsWith('#') ? rawChannel.slice(1) : rawChannel;

    let username = '';
    if (prefix) {
      const exclIdx = prefix.indexOf('!');
      username = exclIdx !== -1 ? prefix.slice(0, exclIdx) : prefix;
    }

    const displayName = tags['display-name'] || username || 'Anonymous';
    const color = tags['color'] && tags['color'].trim() ? tags['color'].trim() : null;
    const id = tags['id'] || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : Date.now();

    return {
      id: id,
      username: username,
      displayName: displayName,
      color: color,
      channel: channel.toLowerCase(),
      text: text,
      timestamp: timestamp,
      tags: tags
    };
  }

  /**
   * Format timestamp into HH:MM (24-hour format)
   */
  function formatTime(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (isNaN(date.getTime())) {
      return '00:00';
    }
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Normalize channel name: strip #, lowercase, trim, validate.
   * Default fallback: 'wow_wyc'
   */
  function normalizeChannel(raw, defaultChannel) {
    const fallback = defaultChannel || 'wow_wyc';
    if (!raw || typeof raw !== 'string') return fallback;
    let cleaned = raw.trim();
    if (cleaned.startsWith('#')) {
      cleaned = cleaned.slice(1);
    }
    cleaned = cleaned.trim().toLowerCase();
    const match = cleaned.match(/^[a-zA-Z0-9_]{1,25}$/);
    return match ? match[0].toLowerCase() : fallback;
  }

  /**
   * Parse channel name from query search string (e.g. ?channel=wow_wyc or channel=wow_wyc)
   */
  function parseChannelFromQuery(searchString, defaultChannel) {
    const fallback = defaultChannel || 'wow_wyc';
    if (!searchString || typeof searchString !== 'string') return fallback;
    try {
      const q = searchString.startsWith('?') ? searchString.slice(1) : searchString;
      const params = new URLSearchParams(q);
      const ch = params.get('channel');
      return ch ? normalizeChannel(ch, fallback) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  /**
   * Generate random 5-digit justinfan username
   */
  function generateJustinfanNick() {
    const num = Math.floor(10000 + Math.random() * 90000);
    return `justinfan${num}`;
  }

  /**
   * Build array of IRC handshake commands for anonymous Twitch WebSocket connection
   */
  function buildAuthCommands(channel, nick) {
    const normChannel = normalizeChannel(channel);
    const chosenNick = nick || generateJustinfanNick();
    return [
      'CAP REQ :twitch.tv/tags twitch.tv/commands',
      'PASS SCHMOOPIIE',
      `NICK ${chosenNick}`,
      `JOIN #${normChannel}`
    ];
  }

  /**
   * Calculate exponential backoff with ceiling
   */
  function calculateBackoff(attempt, baseDelayMs, maxDelayMs) {
    const base = typeof baseDelayMs === 'number' ? baseDelayMs : 2500;
    const max = typeof maxDelayMs === 'number' ? maxDelayMs : 30000;
    const delay = base * Math.pow(2, Math.max(0, attempt));
    return Math.min(max, delay);
  }

  /**
   * Build Gemini prompt for translating a batch of Twitch chat messages.
   * Expects messages: [{ id, text, username, wantReplies }]
   */
  function buildTranslationPrompt(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return '';
    }
    const cleanList = messages.map(function (m) {
      return {
        id: String(m.id),
        text: String(m.text || ''),
        wantReplies: Boolean(m.wantReplies ?? m.reply ?? m.repliesWanted)
      };
    });

    return (
      'You are an expert Twitch chat translator and World of Warcraft (WoW) gaming culture specialist.\n' +
      'Translate the following Twitch chat messages into natural, colloquial Chinese (zh-CN).\n' +
      'Identify and explain any Twitch emotes, slang, gaming acronyms, or WoW terms ' +
      '(e.g., pog, kek, kekw, LFG, tank, heal, dps, wipe, aggro, oom, bis, monkaS, copium, diff, W, L, etc.) ' +
      'in a short, punchy note.\n\n' +
      'For reply suggestions:\n' +
      'Each input message contains a "wantReplies" boolean flag.\n' +
      '- If "wantReplies" is true: generate 3 short English reply options suitable for sending in Twitch chat:\n' +
      '  "simple": Brief, direct, easy English (e.g. "Nice play!", "What build is that?").\n' +
      '  "natural": Authentic native gamer / Twitch chatter style (e.g. "Clean pull ngl, love to see it").\n' +
      '  "playful": Witty, humorous, friendly banter or meme-aware (e.g. "Bro is cooking let him cook haha").\n' +
      '  Include them under a "replies" key formatted as: {"simple": "...", "natural": "...", "playful": "..."} where each reply is a short English string.\n' +
      '- If "wantReplies" is false: DO NOT generate replies. omit the "replies" field completely for that message.\n\n' +
      'Requirements:\n' +
      '1. Return ONLY a valid JSON array of objects.\n' +
      '2. Each object must have keys: "id" (string matching input id), "zh" (Chinese translation), "note" (short slang/WoW explanation or empty string "" if none).\n' +
      '3. When "wantReplies" is true, also include "replies": {"simple": "...", "natural": "...", "playful": "..."} with short English strings. When "wantReplies" is false, omit the "replies" key.\n' +
      '4. Do not include markdown code fences or conversational text.\n\n' +
      'Input messages:\n' +
      JSON.stringify(cleanList, null, 2)
    );
  }

  /**
   * Helper to format a single translation item with optional replies.
   */
  function formatTranslationItem(item) {
    if (!item || typeof item !== 'object') {
      return { id: '', zh: '', note: '' };
    }
    const res = {
      id: String(item.id || ''),
      zh: String(item.zh || ''),
      note: String(item.note || '')
    };
    if (item.replies && typeof item.replies === 'object') {
      const simple = typeof item.replies.simple === 'string'
        ? item.replies.simple
        : (item.replies.simple && item.replies.simple.en ? item.replies.simple.en : '');
      const natural = typeof item.replies.natural === 'string'
        ? item.replies.natural
        : (item.replies.natural && item.replies.natural.en ? item.replies.natural.en : '');
      const playful = typeof item.replies.playful === 'string'
        ? item.replies.playful
        : (item.replies.playful && item.replies.playful.en ? item.replies.playful.en : '');

      if (simple || natural || playful) {
        res.replies = {
          simple: String(simple || '').trim(),
          natural: String(natural || '').trim(),
          playful: String(playful || '').trim()
        };
      }
    }
    return res;
  }

  /**
   * Parse Gemini response for translation batch.
   * Handles raw JSON string, code block wrapped JSON, or Gemini API response object.
   * Returns array of { id, zh, note, replies?: { simple, natural, playful } }.
   */
  function parseTranslationResponse(payload) {
    if (!payload) return [];

    let text = '';
    if (typeof payload === 'string') {
      text = payload;
    } else if (Array.isArray(payload)) {
      return payload.map(formatTranslationItem);
    } else if (payload && payload.candidates && payload.candidates[0]) {
      const candidate = payload.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
        text = candidate.content.parts[0].text || '';
      }
    }

    if (!text || typeof text !== 'string') return [];

    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.map(formatTranslationItem);
      }
      return [];
    } catch (_) {
      // Regex fallback if JSON parsing failed due to small trailing characters
      const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        try {
          const fallbackParsed = JSON.parse(arrayMatch[0]);
          if (Array.isArray(fallbackParsed)) {
            return fallbackParsed.map(formatTranslationItem);
          }
        } catch (__) {
          return [];
        }
      }
      return [];
    }
  }

  /**
   * Determine whether a message should receive auto-reply suggestions.
   * Pure function returning false for:
   * 1. Messages from the streamer (username equals channel, case-insensitive)
   * 2. Messages that are pure emotes (all non-space text falls inside Twitch emotes tag ranges)
   * 3. Very short messages (< 4 letters after removing emotes and punctuation, e.g. "lol", "W", "<3", "EZ")
   * 4. Command messages starting with "!"
   */
  function shouldAutoReply(msg, channel) {
    if (!msg || typeof msg !== 'object') {
      return false;
    }
    const rawText = typeof msg.text === 'string' ? msg.text : '';
    const trimmed = rawText.trim();
    if (!trimmed) {
      return false;
    }

    // Command messages starting with "!"
    if (trimmed.startsWith('!')) {
      return false;
    }

    // Streamer messages (username equals channel, case-insensitive)
    const targetChannel = (channel || msg.channel || '').replace(/^#/, '').trim().toLowerCase();
    const username = (
      msg.username ||
      msg.displayName ||
      (msg.tags && (msg.tags['display-name'] || msg.tags.username)) ||
      ''
    ).trim().toLowerCase();

    if (targetChannel && username && username === targetChannel) {
      return false;
    }

    // Extract Twitch emote tag ranges
    const emotesTag = (msg.tags && typeof msg.tags.emotes === 'string')
      ? msg.tags.emotes
      : (typeof msg.emotes === 'string' ? msg.emotes : '');

    const ranges = [];
    if (emotesTag && emotesTag.trim()) {
      const groups = emotesTag.trim().split('/');
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        if (!group) continue;
        const colonIdx = group.indexOf(':');
        if (colonIdx === -1) continue;
        const occurrences = group.slice(colonIdx + 1).split(',');
        for (let o = 0; o < occurrences.length; o++) {
          const occ = occurrences[o];
          const dashIdx = occ.indexOf('-');
          if (dashIdx === -1) continue;
          const start = parseInt(occ.slice(0, dashIdx), 10);
          const end = parseInt(occ.slice(dashIdx + 1), 10);
          if (!isNaN(start) && !isNaN(end) && start <= end) {
            ranges.push([start, end]);
          }
        }
      }
    }

    // Sort ranges by start index
    ranges.sort((a, b) => a[0] - b[0]);

    // Check if pure emotes: all non-space characters in rawText are inside emote ranges
    if (ranges.length > 0) {
      let hasNonSpace = false;
      let allNonSpaceCovered = true;
      for (let i = 0; i < rawText.length; i++) {
        const char = rawText[i];
        if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') {
          hasNonSpace = true;
          let covered = false;
          for (let r = 0; r < ranges.length; r++) {
            if (i >= ranges[r][0] && i <= ranges[r][1]) {
              covered = true;
              break;
            }
          }
          if (!covered) {
            allNonSpaceCovered = false;
            break;
          }
        }
      }
      if (hasNonSpace && allNonSpaceCovered) {
        return false;
      }
    }

    // Remove emotes from text
    let textWithoutEmotes = '';
    let cursor = 0;
    const mergedRanges = [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (mergedRanges.length === 0) {
        mergedRanges.push([r[0], r[1]]);
      } else {
        const last = mergedRanges[mergedRanges.length - 1];
        if (r[0] <= last[1] + 1) {
          last[1] = Math.max(last[1], r[1]);
        } else {
          mergedRanges.push([r[0], r[1]]);
        }
      }
    }

    for (let i = 0; i < mergedRanges.length; i++) {
      const start = mergedRanges[i][0];
      const end = mergedRanges[i][1];
      if (start > cursor) {
        textWithoutEmotes += rawText.slice(cursor, start);
      }
      cursor = Math.max(cursor, end + 1);
    }
    if (cursor < rawText.length) {
      textWithoutEmotes += rawText.slice(cursor);
    }

    // Very short (< 4 letters after removing emotes and punctuation)
    const letters = textWithoutEmotes.match(/\p{L}/gu) || [];
    if (letters.length < 4) {
      return false;
    }

    return true;
  }

  /**
   * Build Gemini prompt for generating 3 English reply suggestions
   * (Simple, Natural, Playful)
   */
  function buildReplyPrompt(messageText, username) {
    const author = username || 'Chatter';
    return (
      `A Twitch viewer named "${author}" sent this message in live chat:\n` +
      `"${messageText}"\n\n` +
      'Generate 3 different English replies suitable for sending in Twitch chat:\n' +
      '1. "simple": Brief, direct, easy English (e.g. "Nice play!", "Lmao same", "What gear is that?").\n' +
      '2. "natural": How authentic native gamers/Twitch chatters talk, using contemporary gaming cadence.\n' +
      '3. "playful": Witty, humorous, banter or meme-aware (friendly, never toxic).\n\n' +
      'Provide a short Chinese explanation (zhDesc) for each so the user understands the exact vibe/nuance.\n\n' +
      'Return ONLY a valid JSON object matching this schema:\n' +
      '{\n' +
      '  "simple": { "en": "...", "zhDesc": "..." },\n' +
      '  "natural": { "en": "...", "zhDesc": "..." },\n' +
      '  "playful": { "en": "...", "zhDesc": "..." }\n' +
      '}'
    );
  }

  /**
   * Parse Gemini response for reply suggestions
   */
  function parseReplyResponse(payload) {
    const defaultResult = {
      simple: { en: 'Nice!', zhDesc: '简洁赞叹' },
      natural: { en: 'Clean pull, love to see it!', zhDesc: '地道游戏互动' },
      playful: { en: 'Bro is cooking let him cook haha', zhDesc: '幽默造梗' }
    };

    if (!payload) return defaultResult;

    let text = '';
    if (typeof payload === 'string') {
      text = payload;
    } else if (payload && payload.candidates && payload.candidates[0]) {
      const candidate = payload.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
        text = candidate.content.parts[0].text || '';
      }
    } else if (typeof payload === 'object' && payload.simple) {
      return {
        simple: { en: String(payload.simple?.en || ''), zhDesc: String(payload.simple?.zhDesc || '') },
        natural: { en: String(payload.natural?.en || ''), zhDesc: String(payload.natural?.zhDesc || '') },
        playful: { en: String(payload.playful?.en || ''), zhDesc: String(payload.playful?.zhDesc || '') }
      };
    }

    if (!text || typeof text !== 'string') return defaultResult;

    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        return {
          simple: {
            en: String(parsed.simple?.en || parsed.simple || 'Nice!'),
            zhDesc: String(parsed.simple?.zhDesc || '简洁回复')
          },
          natural: {
            en: String(parsed.natural?.en || parsed.natural || 'Clean pull ngl!'),
            zhDesc: String(parsed.natural?.zhDesc || '地道弹幕')
          },
          playful: {
            en: String(parsed.playful?.en || parsed.playful || 'Bro is cooking haha'),
            zhDesc: String(parsed.playful?.zhDesc || '幽默调侃')
          }
        };
      }
      return defaultResult;
    } catch (_) {
      return defaultResult;
    }
  }

  /**
   * Check color brightness and return a readable color for dark background.
   */
  function getReadableColor(hexColor, fallback) {
    const defaultColor = fallback || '#a970ff'; // Twitch purple
    if (!hexColor || typeof hexColor !== 'string' || !hexColor.startsWith('#')) {
      return defaultColor;
    }
    const clean = hexColor.replace('#', '');
    if (clean.length !== 6 && clean.length !== 3) {
      return defaultColor;
    }
    let r, g, b;
    if (clean.length === 3) {
      r = parseInt(clean[0] + clean[0], 16);
      g = parseInt(clean[1] + clean[1], 16);
      b = parseInt(clean[2] + clean[2], 16);
    } else {
      r = parseInt(clean.slice(0, 2), 16);
      g = parseInt(clean.slice(2, 4), 16);
      b = parseInt(clean.slice(4, 6), 16);
    }

    // Relative luminance calculation
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // If too dark (< 0.35) for dark mode (#0e0e10), brighten color
    if (lum < 0.35) {
      const factor = 1.6;
      const nr = Math.min(255, Math.floor(r * factor + 60));
      const ng = Math.min(255, Math.floor(g * factor + 60));
      const nb = Math.min(255, Math.floor(b * factor + 60));
      return `rgb(${nr}, ${ng}, ${nb})`;
    }
    return hexColor;
  }

  /**
   * MessageBatcher class to handle queuing, interval batching, and backoff
   */
  class MessageBatcher {
    constructor(options) {
      options = options || {};
      this.intervalMs = typeof options.intervalMs === 'number' ? options.intervalMs : 2500;
      this.maxBatchSize = typeof options.maxBatchSize === 'number' ? options.maxBatchSize : 20;
      this.onDrop = options.onDrop || null;
      this.onFlush = typeof options.onFlush === 'function' ? options.onFlush : null;

      this.queue = [];
      this.timer = null;
      this.backoffAttempt = 0;
      this.isPaused = false;
    }

    add(message) {
      if (!message || !message.id) return;
      // Prevent duplicate queued IDs
      if (this.queue.some(item => item.id === message.id)) {
        return;
      }
      this.queue.push(message);
      // Busy chat: keep only the newest messages to protect API quota
      const cap = this.maxBatchSize * 2;
      if (this.queue.length > cap) {
        const dropped = this.queue.splice(0, this.queue.length - cap);
        if (typeof this.onDrop === 'function') this.onDrop(dropped);
      }
      // Never flush faster than intervalMs (rate limit friendly)
      if (!this.timer && !this.isPaused) {
        this.scheduleNextFlush(this.intervalMs);
      }
    }

    scheduleNextFlush(delayMs) {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, delayMs);
    }

    flush() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.queue.length === 0) {
        return [];
      }
      const batch = this.queue.splice(0, this.maxBatchSize);
      if (this.onFlush) {
        this.onFlush(batch);
      }
      // If there are still items left in the queue, schedule another flush
      if (this.queue.length > 0 && !this.isPaused) {
        this.scheduleNextFlush(this.intervalMs);
      }
      return batch;
    }

    getPending() {
      return [...this.queue];
    }

    size() {
      return this.queue.length;
    }

    clear() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.queue = [];
    }

    recordSuccess() {
      this.backoffAttempt = 0;
      this.isPaused = false;
      if (this.queue.length > 0 && !this.timer) {
        this.scheduleNextFlush(this.intervalMs);
      }
    }

    recordError(status) {
      const is429 = status === 429;
      this.backoffAttempt++;
      const baseDelay = is429 ? 5000 : 3000;
      const delay = calculateBackoff(this.backoffAttempt, baseDelay, 45000);

      this.isPaused = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }

      // Resume after backoff delay
      this.timer = setTimeout(() => {
        this.timer = null;
        this.isPaused = false;
        if (this.queue.length > 0) {
          this.flush();
        }
      }, delay);

      return delay;
    }
  }

  return {
    unescapeTagValue: unescapeTagValue,
    parseIrcTags: parseIrcTags,
    parsePrivmsg: parsePrivmsg,
    formatTime: formatTime,
    normalizeChannel: normalizeChannel,
    parseChannelFromQuery: parseChannelFromQuery,
    generateJustinfanNick: generateJustinfanNick,
    buildAuthCommands: buildAuthCommands,
    calculateBackoff: calculateBackoff,
    buildTranslationPrompt: buildTranslationPrompt,
    parseTranslationResponse: parseTranslationResponse,
    shouldAutoReply: shouldAutoReply,
    buildReplyPrompt: buildReplyPrompt,
    parseReplyResponse: parseReplyResponse,
    getReadableColor: getReadableColor,
    MessageBatcher: MessageBatcher
  };
});
