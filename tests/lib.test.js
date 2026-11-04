const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Lib = require('../lib.js');

describe('IRC Tag Parsing', () => {
  test('returns empty object for falsy or empty inputs', () => {
    assert.deepEqual(Lib.parseIrcTags(''), {});
    assert.deepEqual(Lib.parseIrcTags(null), {});
    assert.deepEqual(Lib.parseIrcTags(undefined), {});
  });

  test('parses simple tags with and without leading @', () => {
    const rawWithAt = '@color=#FF0000;display-name=WyC;mod=1';
    assert.deepEqual(Lib.parseIrcTags(rawWithAt), {
      color: '#FF0000',
      'display-name': 'WyC',
      mod: '1'
    });

    const rawWithoutAt = 'color=#00FF00;subscriber=0';
    assert.deepEqual(Lib.parseIrcTags(rawWithoutAt), {
      color: '#00FF00',
      subscriber: '0'
    });
  });

  test('correctly unescapes IRCv3 tag values', () => {
    // \: -> ; , \s -> space, \\ -> \ , \r, \n
    const raw = '@message=hello\\sworld;semi=a\\:b;slash=c\\\\d;breaks=line1\\nline2\\rline3';
    const parsed = Lib.parseIrcTags(raw);
    assert.equal(parsed.message, 'hello world');
    assert.equal(parsed.semi, 'a;b');
    assert.equal(parsed.slash, 'c\\d');
    assert.equal(parsed.breaks, 'line1\nline2\rline3');
  });

  test('handles empty tag values and trailing semicolons', () => {
    const raw = '@emotes=;badges=;flags=;mod=0;';
    const parsed = Lib.parseIrcTags(raw);
    assert.equal(parsed.emotes, '');
    assert.equal(parsed.badges, '');
    assert.equal(parsed.flags, '');
    assert.equal(parsed.mod, '0');
  });
});

describe('PRIVMSG Parsing', () => {
  test('parses standard PRIVMSG with full tags', () => {
    const raw = '@badge-info=;badges=broadcaster/1;color=#1E90FF;display-name=WyC;emotes=;id=msg-001;mod=0;room-id=123;subscriber=0;tmi-sent-ts=1700000000000 :wyc!wyc@wyc.tmi.twitch.tv PRIVMSG #wow_wyc :pog tank pull LFG!';
    const result = Lib.parsePrivmsg(raw);

    assert.ok(result);
    assert.equal(result.id, 'msg-001');
    assert.equal(result.displayName, 'WyC');
    assert.equal(result.username, 'wyc');
    assert.equal(result.color, '#1E90FF');
    assert.equal(result.channel, 'wow_wyc');
    assert.equal(result.text, 'pog tank pull LFG!');
    assert.equal(result.timestamp, 1700000000000);
    assert.equal(result.tags['room-id'], '123');
  });

  test('parses PRIVMSG without tags', () => {
    const raw = ':random_viewer!random_viewer@random_viewer.tmi.twitch.tv PRIVMSG #wow_wyc :hello chat';
    const result = Lib.parsePrivmsg(raw);

    assert.ok(result);
    assert.equal(result.displayName, 'random_viewer');
    assert.equal(result.username, 'random_viewer');
    assert.equal(result.channel, 'wow_wyc');
    assert.equal(result.text, 'hello chat');
    assert.equal(result.color, null);
    assert.ok(result.id.startsWith('msg-'));
  });

  test('preserves multiple colons and special characters in message text', () => {
    const raw = '@display-name=Gamer :gamer!gamer@tmi.twitch.tv PRIVMSG #wow_wyc :https://example.com/stream :D ::pog::';
    const result = Lib.parsePrivmsg(raw);

    assert.ok(result);
    assert.equal(result.text, 'https://example.com/stream :D ::pog::');
  });

  test('returns null for non-PRIVMSG lines', () => {
    assert.equal(Lib.parsePrivmsg('PING :tmi.twitch.tv'), null);
    assert.equal(Lib.parsePrivmsg(':tmi.twitch.tv 001 justinfan123 :Welcome'), null);
    assert.equal(Lib.parsePrivmsg(':justinfan123!justinfan123@tmi.twitch.tv JOIN #wow_wyc'), null);
    assert.equal(Lib.parsePrivmsg(''), null);
    assert.equal(Lib.parsePrivmsg(null), null);
  });

  test('formatTime formats timestamp to HH:MM', () => {
    const date = new Date(2026, 10, 4, 15, 30); // 15:30
    assert.equal(Lib.formatTime(date.getTime()), '15:30');

    const morningDate = new Date(2026, 10, 4, 8, 5); // 08:05
    assert.equal(Lib.formatTime(morningDate.getTime()), '08:05');
  });
});

describe('Channel Parameter Parsing & Normalization', () => {
  test('normalizeChannel handles clean, hash prefixed, and uppercase channel names', () => {
    assert.equal(Lib.normalizeChannel('wow_wyc'), 'wow_wyc');
    assert.equal(Lib.normalizeChannel('#wow_wyc'), 'wow_wyc');
    assert.equal(Lib.normalizeChannel('  #WoW_WyC  '), 'wow_wyc');
    assert.equal(Lib.normalizeChannel('Shroud'), 'shroud');
  });

  test('normalizeChannel falls back to default on invalid or empty names', () => {
    assert.equal(Lib.normalizeChannel('', 'wow_wyc'), 'wow_wyc');
    assert.equal(Lib.normalizeChannel(null, 'wow_wyc'), 'wow_wyc');
    assert.equal(Lib.normalizeChannel('invalid@name!', 'wow_wyc'), 'wow_wyc');
  });

  test('parseChannelFromQuery extracts channel from URL query string', () => {
    assert.equal(Lib.parseChannelFromQuery('?channel=shroud'), 'shroud');
    assert.equal(Lib.parseChannelFromQuery('channel=asmongold'), 'asmongold');
    assert.equal(Lib.parseChannelFromQuery('?channel=%23tarik'), 'tarik');
    assert.equal(Lib.parseChannelFromQuery('?other=1&channel=xqc&mode=dark'), 'xqc');
  });

  test('parseChannelFromQuery falls back to defaultChannel when missing or invalid', () => {
    assert.equal(Lib.parseChannelFromQuery('?other=1', 'wow_wyc'), 'wow_wyc');
    assert.equal(Lib.parseChannelFromQuery('', 'wow_wyc'), 'wow_wyc');
    assert.equal(Lib.parseChannelFromQuery('?channel=$$$bad', 'wow_wyc'), 'wow_wyc');
  });

  test('buildAuthCommands generates expected IRC handshake sequence', () => {
    const commands = Lib.buildAuthCommands('wow_wyc', 'justinfan12345');
    assert.equal(commands.length, 4);
    assert.equal(commands[0], 'CAP REQ :twitch.tv/tags twitch.tv/commands');
    assert.equal(commands[1], 'PASS SCHMOOPIIE');
    assert.equal(commands[2], 'NICK justinfan12345');
    assert.equal(commands[3], 'JOIN #wow_wyc');
  });

  test('generateJustinfanNick produces valid 5-digit justinfan username', () => {
    const nick = Lib.generateJustinfanNick();
    assert.match(nick, /^justinfan\d{5}$/);
  });
});

describe('Batching & Translation Logic', () => {
  test('buildTranslationPrompt creates structured prompt with IDs', () => {
    const msgs = [
      { id: '1', text: 'poggers tank' },
      { id: '2', text: 'LFG mythic+' }
    ];
    const prompt = Lib.buildTranslationPrompt(msgs);
    assert.ok(prompt.includes('poggers tank'));
    assert.ok(prompt.includes('LFG mythic+'));
    assert.ok(prompt.includes('JSON array'));
    assert.ok(prompt.includes('"id": "1"'));
  });

  test('parseTranslationResponse parses valid JSON array', () => {
    const jsonStr = JSON.stringify([
      { id: '1', zh: '太棒了坦克', note: 'pog: 赞叹/精彩' },
      { id: '2', zh: '求组大秘境', note: 'LFG: Looking For Group, 组队寻找队友' }
    ]);
    const parsed = Lib.parseTranslationResponse(jsonStr);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].id, '1');
    assert.equal(parsed[0].zh, '太棒了坦克');
    assert.equal(parsed[0].note, 'pog: 赞叹/精彩');
  });

  test('parseTranslationResponse handles markdown code fences', () => {
    const fenced = '```json\n[{"id":"m1","zh":"灭团了","note":"wipe: 团灭"}]\n```';
    const parsed = Lib.parseTranslationResponse(fenced);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'm1');
    assert.equal(parsed[0].zh, '灭团了');
    assert.equal(parsed[0].note, 'wipe: 团灭');
  });

  test('parseTranslationResponse extracts from Gemini API candidate response object', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify([
                  { id: 'x9', zh: '笑死', note: 'kek: 魔兽部落语笑声，等同于lol' }
                ])
              }
            ]
          }
        }
      ]
    };
    const parsed = Lib.parseTranslationResponse(payload);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'x9');
    assert.equal(parsed[0].zh, '笑死');
    assert.equal(parsed[0].note, 'kek: 魔兽部落语笑声，等同于lol');
  });

  test('calculateBackoff calculates exponential delay with cap', () => {
    const b0 = Lib.calculateBackoff(0, 2500, 30000);
    const b1 = Lib.calculateBackoff(1, 2500, 30000);
    const b2 = Lib.calculateBackoff(2, 2500, 30000);
    const b5 = Lib.calculateBackoff(5, 2500, 30000);

    assert.equal(b0, 2500);
    assert.equal(b1, 5000);
    assert.equal(b2, 10000);
    assert.equal(b5, 30000); // capped at 30000
  });

  test('MessageBatcher flushes on interval, never immediately', (t, done) => {
    const flushed = [];
    const batcher = new Lib.MessageBatcher({ intervalMs: 50, maxBatchSize: 3, onFlush: (b) => flushed.push(b) });
    for (let i = 1; i <= 3; i++) batcher.add({ id: String(i), text: 'm' + i });
    assert.equal(flushed.length, 0);
    setTimeout(() => {
      assert.equal(flushed.length, 1);
      assert.equal(flushed[0].length, 3);
      batcher.clear();
      done();
    }, 80);
  });

  test('MessageBatcher caps queue at 2x batch size and drops oldest', (t, done) => {
    const flushed = []; const dropped = [];
    const batcher = new Lib.MessageBatcher({ intervalMs: 50, maxBatchSize: 4, onFlush: (b) => flushed.push(b), onDrop: (d) => dropped.push(...d) });
    for (let i = 1; i <= 10; i++) batcher.add({ id: 'msg-' + i, text: 't' });
    assert.equal(batcher.size(), 8);
    assert.deepEqual(dropped.map(d => d.id), ['msg-1', 'msg-2']);
    setTimeout(() => {
      assert.equal(flushed.length, 1);
      assert.equal(flushed[0].length, 4);
      assert.equal(flushed[0][0].id, 'msg-3');
      batcher.clear();
      done();
    }, 80);
  });

  test('MessageBatcher deduplicates queued IDs', () => {
    const batcher = new Lib.MessageBatcher({ intervalMs: 1000 });
    batcher.add({ id: 'repeat-1', text: 'hello' });
    batcher.add({ id: 'repeat-1', text: 'hello' });
    assert.equal(batcher.size(), 1);
    batcher.clear();
  });

  test('MessageBatcher handles recordError and backoff pause', (t, done) => {
    let flushCount = 0;
    const batcher = new Lib.MessageBatcher({
      intervalMs: 50,
      onFlush: () => {
        flushCount++;
      }
    });

    batcher.add({ id: 'err-1', text: 'fail soon' });
    // Simulate error 429
    const delay = batcher.recordError(429);
    assert.ok(delay >= 5000); // 429 base is 5000ms
    assert.equal(batcher.isPaused, true);

    // Calling recordSuccess resets backoff and unpauses
    batcher.recordSuccess();
    assert.equal(batcher.isPaused, false);
    assert.equal(batcher.backoffAttempt, 0);

    batcher.clear();
    done();
  });

  test('buildTranslationPrompt returns empty string for empty input', () => {
    assert.equal(Lib.buildTranslationPrompt([]), '');
    assert.equal(Lib.buildTranslationPrompt(null), '');
  });

  test('buildTranslationPrompt includes wantReplies flag and instructs to omit replies when false', () => {
    const msgs = [
      { id: '10', text: 'Clean pull, what build is that?', wantReplies: true },
      { id: '11', text: 'lol', wantReplies: false }
    ];
    const prompt = Lib.buildTranslationPrompt(msgs);
    assert.ok(prompt.includes('"wantReplies": true'));
    assert.ok(prompt.includes('"wantReplies": false'));
    assert.ok(prompt.includes('omit the "replies" field'));
    assert.ok(prompt.includes('"simple"'));
    assert.ok(prompt.includes('"natural"'));
    assert.ok(prompt.includes('"playful"'));
  });

  test('parseTranslationResponse parses replies object when returned by Gemini', () => {
    const jsonStr = JSON.stringify([
      {
        id: '10',
        zh: '拉怪很漂亮，你是什么天赋？',
        note: 'pull: 开怪/拉怪',
        replies: {
          simple: 'Nice pull! What build?',
          natural: 'Clean pull ngl, drop the build?',
          playful: 'Bro cooked that pull sheesh'
        }
      },
      {
        id: '11',
        zh: '笑死',
        note: 'lol: 大笑'
      }
    ]);
    const parsed = Lib.parseTranslationResponse(jsonStr);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].id, '10');
    assert.ok(parsed[0].replies);
    assert.equal(parsed[0].replies.simple, 'Nice pull! What build?');
    assert.equal(parsed[0].replies.natural, 'Clean pull ngl, drop the build?');
    assert.equal(parsed[0].replies.playful, 'Bro cooked that pull sheesh');

    assert.equal(parsed[1].id, '11');
    assert.equal(parsed[1].replies, undefined);
  });
});

describe('Auto Reply Eligibility (shouldAutoReply)', () => {
  test('returns false for streamer messages (username equals channel, case-insensitive)', () => {
    // Exact match
    assert.equal(Lib.shouldAutoReply({ username: 'wow_wyc', text: 'Hello chat, welcome!' }, 'wow_wyc'), false);
    // Case-insensitive & hash prefix
    assert.equal(Lib.shouldAutoReply({ username: 'WoW_WyC', text: 'Starting the raid now' }, '#wow_wyc'), false);
    // Channel from msg property
    assert.equal(Lib.shouldAutoReply({ username: 'shroud', channel: 'shroud', text: 'Thanks for coming by' }), false);
    // Display-name tag
    assert.equal(Lib.shouldAutoReply({ displayName: 'StreamerOne', text: 'Hey guys', tags: {} }, 'streamerone'), false);
  });

  test('returns false for command messages starting with "!"', () => {
    assert.equal(Lib.shouldAutoReply({ username: 'viewer1', text: '!drop' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer2', text: '  !roll 100' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer3', text: '!help with talents please' }, 'wow_wyc'), false);
  });

  test('returns false for pure emote messages', () => {
    // Single emote: "Kappa" (0-4)
    assert.equal(
      Lib.shouldAutoReply(
        { username: 'viewer', text: 'Kappa', tags: { emotes: '25:0-4' } },
        'wow_wyc'
      ),
      false
    );

    // Repeated emotes: "Kappa Kappa" (0-4, 6-10)
    assert.equal(
      Lib.shouldAutoReply(
        { username: 'viewer', text: 'Kappa Kappa', tags: { emotes: '25:0-4,6-10' } },
        'wow_wyc'
      ),
      false
    );

    // Multiple different emotes: "Kappa PogChamp" (0-4 / 6-13)
    assert.equal(
      Lib.shouldAutoReply(
        { username: 'viewer', text: 'Kappa PogChamp', tags: { emotes: '25:0-4/88:6-13' } },
        'wow_wyc'
      ),
      false
    );

    // Emotes with leading/trailing spaces
    assert.equal(
      Lib.shouldAutoReply(
        { username: 'viewer', text: '  Kappa  ', tags: { emotes: '25:2-6' } },
        'wow_wyc'
      ),
      false
    );
  });

  test('returns false for very short messages (< 4 letters after removing emotes/punctuation)', () => {
    // Examples from requirements: "lol", "W", "<3", "EZ"
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: 'lol' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: 'W' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: '<3' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: 'EZ' }, 'wow_wyc'), false);

    // Other short reactions & emotes
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: 'gg' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: 'pog' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: 'L' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: '???' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'viewer', text: '!' }, 'wow_wyc'), false);

    // Message with emote + short remaining text (< 4 letters)
    assert.equal(
      Lib.shouldAutoReply(
        { username: 'viewer', text: 'Kappa lol', tags: { emotes: '25:0-4' } },
        'wow_wyc'
      ),
      false
    );
    assert.equal(
      Lib.shouldAutoReply(
        { username: 'viewer', text: 'Kappa <3', tags: { emotes: '25:0-4' } },
        'wow_wyc'
      ),
      false
    );
    assert.equal(
      Lib.shouldAutoReply(
        { username: 'viewer', text: 'Kappa !', tags: { emotes: '25:0-4' } },
        'wow_wyc'
      ),
      false
    );
  });

  test('returns false for empty, whitespace, or invalid inputs', () => {
    assert.equal(Lib.shouldAutoReply(null, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply(undefined, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({}, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'v', text: '' }, 'wow_wyc'), false);
    assert.equal(Lib.shouldAutoReply({ username: 'v', text: '    ' }, 'wow_wyc'), false);
  });

  test('returns true for valid, interactive chatter messages (>= 4 letters)', () => {
    assert.equal(
      Lib.shouldAutoReply({ username: 'viewer1', text: 'Can you show your talents?' }, 'wow_wyc'),
      true
    );
    assert.equal(
      Lib.shouldAutoReply({ username: 'viewer2', text: 'Nice healing in that mythic key!' }, 'wow_wyc'),
      true
    );
    assert.equal(
      Lib.shouldAutoReply({ username: 'viewer3', text: 'ggwp' }, 'wow_wyc'),
      true
    );
    assert.equal(
      Lib.shouldAutoReply({ username: 'viewer4', text: 'lmao that was hilarious' }, 'wow_wyc'),
      true
    );
    // Emote followed by substantive question/comment
    assert.equal(
      Lib.shouldAutoReply(
        { username: 'viewer5', text: 'Kappa how did you survive that mechanic?', tags: { emotes: '25:0-4' } },
        'wow_wyc'
      ),
      true
    );
  });
});

describe('Reply Suggestion Logic', () => {
  test('buildReplyPrompt formats request with message and author', () => {
    const prompt = Lib.buildReplyPrompt('Did he just wipe the raid?', 'GamerGirl');
    assert.ok(prompt.includes('GamerGirl'));
    assert.ok(prompt.includes('Did he just wipe the raid?'));
    assert.ok(prompt.includes('"simple"'));
    assert.ok(prompt.includes('"natural"'));
    assert.ok(prompt.includes('"playful"'));
  });

  test('parseReplyResponse parses 3 reply styles', () => {
    const payload = JSON.stringify({
      simple: { en: 'Unlucky pull!', zhDesc: '直率表达惋惜' },
      natural: { en: 'Bro aggroed the whole room ngl', zhDesc: '地道游戏调侃' },
      playful: { en: 'Tank POV: everything is fine PepeLaugh', zhDesc: '经典梗图嘲讽' }
    });

    const parsed = Lib.parseReplyResponse(payload);
    assert.equal(parsed.simple.en, 'Unlucky pull!');
    assert.equal(parsed.natural.en, 'Bro aggroed the whole room ngl');
    assert.equal(parsed.playful.en, 'Tank POV: everything is fine PepeLaugh');
    assert.equal(parsed.playful.zhDesc, '经典梗图嘲讽');
  });

  test('parseReplyResponse provides fallback on parse failure', () => {
    const fallback = Lib.parseReplyResponse('invalid json text');
    assert.ok(fallback.simple && fallback.simple.en);
    assert.ok(fallback.natural && fallback.natural.en);
    assert.ok(fallback.playful && fallback.playful.en);
  });
});

describe('Color Contrast & Readability', () => {
  test('brightens overly dark colors for dark background readability', () => {
    const darkBlue = '#000055';
    const readable = Lib.getReadableColor(darkBlue);
    assert.notEqual(readable, darkBlue);
    assert.ok(readable.startsWith('rgb('));

    const brightCyan = '#00FFFF';
    assert.equal(Lib.getReadableColor(brightCyan), '#00FFFF');
  });
});
