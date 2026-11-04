/**
 * Twitch English Copilot - app.js
 * Frontend controller handling:
 * - Anonymous Twitch IRC WebSocket connection & auto-reconnect
 * - Message rendering, auto-scrolling & cap at 300 messages
 * - Gemini REST batch translation (~2.5s interval) and slang notes
 * - 3 English reply suggestions modal (Simple, Natural, Playful) with clipboard copy
 * - Settings panel with localStorage persistence & key-banner management
 */

(function () {
  'use strict';

  // Global pure library reference
  const Lib = window.Lib;
  if (!Lib) {
    console.error('Lib library failed to load');
    return;
  }

  // LocalStorage keys
  const STORAGE_KEY_API_KEY = 'twitch_copilot_gemini_key';
  const STORAGE_KEY_MODEL = 'twitch_copilot_gemini_model';
  const DEFAULT_CHANNEL = 'wow_wyc';
  const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
  const MAX_MESSAGES = 300;
  const BATCH_INTERVAL_MS = 2500;

  // DOM Elements
  const elements = {
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    channelForm: document.getElementById('channel-form'),
    channelInput: document.getElementById('channel-input'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    keyBanner: document.getElementById('key-banner'),
    btnBannerSettings: document.getElementById('btn-banner-settings'),
    chatMessages: document.getElementById('chat-messages'),
    chatEmptyState: document.getElementById('chat-empty-state'),
    btnScrollBottom: document.getElementById('btn-scroll-bottom'),
    unreadCountBadge: document.getElementById('unread-count-badge'),

    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    inputApiKey: document.getElementById('input-api-key'),
    btnToggleKeyVisibility: document.getElementById('btn-toggle-key-visibility'),
    selectModel: document.getElementById('select-model'),
    inputCustomModel: document.getElementById('input-custom-model'),
    btnTestKey: document.getElementById('btn-test-key'),
    testKeyStatus: document.getElementById('test-key-status'),
    btnClearSettings: document.getElementById('btn-clear-settings'),
    btnSaveSettings: document.getElementById('btn-save-settings'),

    // Reply Sheet Modal
    replySheet: document.getElementById('reply-sheet'),
    btnCloseSheet: document.getElementById('btn-close-sheet'),
    sourceAuthor: document.getElementById('source-author'),
    sourceTime: document.getElementById('source-time'),
    sourceText: document.getElementById('source-text'),
    sourceTranslation: document.getElementById('source-translation'),
    suggestionsLoading: document.getElementById('suggestions-loading'),
    suggestionsCards: document.getElementById('suggestions-cards'),
    suggestionsError: document.getElementById('suggestions-error'),
    suggestionsErrorText: document.getElementById('suggestions-error-text'),
    btnRetrySuggestions: document.getElementById('btn-retry-suggestions'),
    replySimpleEn: document.getElementById('reply-simple-en'),
    replySimpleZh: document.getElementById('reply-simple-zh'),
    replyNaturalEn: document.getElementById('reply-natural-en'),
    replyNaturalZh: document.getElementById('reply-natural-zh'),
    replyPlayfulEn: document.getElementById('reply-playful-en'),
    replyPlayfulZh: document.getElementById('reply-playful-zh'),

    // Toast
    toast: document.getElementById('toast')
  };

  // State
  const state = {
    channel: DEFAULT_CHANNEL,
    ws: null,
    wsReconnectAttempt: 0,
    wsReconnectTimer: null,
    apiKey: localStorage.getItem(STORAGE_KEY_API_KEY) || '',
    model: (/^gemini-(1|2)\./.test(localStorage.getItem(STORAGE_KEY_MODEL) || '') ? DEFAULT_MODEL : (localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_MODEL)),
    messageStore: new Map(), // id -> { id, author, text, timestamp, color, zh, note, replies }
    unreadCount: 0,
    userScrolledUp: false,
    currentReplyMsgId: null
  };

  // Initialize Batcher
  const messageBatcher = new Lib.MessageBatcher({
    intervalMs: BATCH_INTERVAL_MS,
    maxBatchSize: 15,
    onFlush: handleBatchFlush
  });

  /* ==========================================================================
     Toast Notifications
     ========================================================================== */
  let toastTimer = null;
  function showToast(message, durationMs = 2200) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.classList.add('hidden');
    }, durationMs);
  }

  /* ==========================================================================
     Key Banner & Settings Sync
     ========================================================================== */
  function updateKeyBannerState() {
    if (!elements.keyBanner) return;
    if (state.apiKey && state.apiKey.trim().length > 0) {
      elements.keyBanner.classList.add('hidden');
    } else {
      elements.keyBanner.classList.remove('hidden');
    }
  }

  function openSettingsModal() {
    elements.inputApiKey.value = state.apiKey;
    if (['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-latest'].includes(state.model)) {
      elements.selectModel.value = state.model;
      elements.inputCustomModel.classList.add('hidden');
    } else {
      elements.selectModel.value = 'custom';
      elements.inputCustomModel.value = state.model;
      elements.inputCustomModel.classList.remove('hidden');
    }
    elements.testKeyStatus.textContent = '';
    elements.testKeyStatus.className = 'test-key-status';
    elements.settingsModal.classList.remove('hidden');
    elements.settingsModal.setAttribute('aria-hidden', 'false');
  }

  function closeSettingsModal() {
    elements.settingsModal.classList.add('hidden');
    elements.settingsModal.setAttribute('aria-hidden', 'true');
  }

  function saveSettings() {
    const rawKey = elements.inputApiKey.value.trim();
    let chosenModel = elements.selectModel.value;
    if (chosenModel === 'custom') {
      chosenModel = elements.inputCustomModel.value.trim() || DEFAULT_MODEL;
    }

    state.apiKey = rawKey;
    state.model = chosenModel;

    if (rawKey) {
      localStorage.setItem(STORAGE_KEY_API_KEY, rawKey);
    } else {
      localStorage.removeItem(STORAGE_KEY_API_KEY);
    }
    localStorage.setItem(STORAGE_KEY_MODEL, chosenModel);

    updateKeyBannerState();
    closeSettingsModal();
    showToast('设置已保存');

    // Trigger batch translation for pending untranslated messages
    if (rawKey && messageBatcher.size() > 0) {
      messageBatcher.flush();
    }
  }

  function clearSettings() {
    if (confirm('确定要清除已保存的 API Key 与模型配置吗？')) {
      localStorage.removeItem(STORAGE_KEY_API_KEY);
      localStorage.removeItem(STORAGE_KEY_MODEL);
      state.apiKey = '';
      state.model = DEFAULT_MODEL;
      elements.inputApiKey.value = '';
      elements.selectModel.value = DEFAULT_MODEL;
      elements.inputCustomModel.classList.add('hidden');
      elements.testKeyStatus.textContent = '已清除配置';
      elements.testKeyStatus.className = 'test-key-status';
      updateKeyBannerState();
      showToast('配置已清除');
    }
  }

  /* ==========================================================================
     Gemini REST API Calls
     ========================================================================== */
  async function requestGemini(promptText, apiKey, model) {
    const activeModel = model || state.model || DEFAULT_MODEL;
    const activeKey = apiKey || state.apiKey;
    if (!activeKey) {
      throw new Error('No API key provided');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(activeKey)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: promptText }]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    return response;
  }

  async function testGeminiApiKey() {
    const testKey = elements.inputApiKey.value.trim();
    if (!testKey) {
      elements.testKeyStatus.textContent = '请先输入 API Key';
      elements.testKeyStatus.className = 'test-key-status error';
      return;
    }

    let modelToTest = elements.selectModel.value;
    if (modelToTest === 'custom') {
      modelToTest = elements.inputCustomModel.value.trim() || DEFAULT_MODEL;
    }

    elements.testKeyStatus.textContent = '正在测试连接...';
    elements.testKeyStatus.className = 'test-key-status';
    elements.btnTestKey.disabled = true;

    try {
      const response = await requestGemini('Hello, reply with JSON {"status":"ok"}', testKey, modelToTest);
      if (response.ok) {
        elements.testKeyStatus.textContent = '✓ 连接成功！模型响应正常';
        elements.testKeyStatus.className = 'test-key-status success';
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error?.message || `HTTP ${response.status}`;
        elements.testKeyStatus.textContent = `✗ 失败: ${errMsg}`;
        elements.testKeyStatus.className = 'test-key-status error';
      }
    } catch (err) {
      elements.testKeyStatus.textContent = `✗ 网络错误: ${err.message}`;
      elements.testKeyStatus.className = 'test-key-status error';
    } finally {
      elements.btnTestKey.disabled = false;
    }
  }

  /* ==========================================================================
     Batch Translation Processor (~2.5s)
     ========================================================================== */
  async function handleBatchFlush(batch) {
    if (!batch || batch.length === 0) return;

    if (!state.apiKey) {
      // No API key configured: do not call Gemini, keep message quiet
      batch.forEach(item => {
        const transEl = document.getElementById(`trans-${item.id}`);
        if (transEl) {
          transEl.innerHTML = '<span class="msg-trans-tip">未设置 key</span>';
          transEl.classList.remove('msg-translating');
        }
      });
      return;
    }

    // Set UI to translating
    batch.forEach(item => {
      const transEl = document.getElementById(`trans-${item.id}`);
      if (transEl) {
        transEl.innerHTML = '<span class="loader-spinner" style="width:12px;height:12px;display:inline-block;border-width:2px;vertical-align:middle;margin-right:6px;"></span> 翻译中...';
        transEl.classList.add('msg-translating');
      }
    });

    const prompt = Lib.buildTranslationPrompt(batch);

    try {
      const response = await requestGemini(prompt, state.apiKey, state.model);

      if (response.status === 429) {
        const backoffDelay = messageBatcher.recordError(429);
        const sec = Math.round(backoffDelay / 1000);
        batch.forEach(item => {
          const transEl = document.getElementById(`trans-${item.id}`);
          if (transEl) {
            transEl.innerHTML = `<span class="msg-trans-error">⚠️ 429 请求超限 (${sec}s 后自动重试)</span>`;
            transEl.classList.remove('msg-translating');
          }
        });
        return;
      }

      if (!response.ok) {
        messageBatcher.recordError(response.status);
        batch.forEach(item => {
          const transEl = document.getElementById(`trans-${item.id}`);
          if (transEl) {
            transEl.innerHTML = `<span class="msg-trans-error">⚠️ 翻译服务错误 (${response.status})</span>`;
            transEl.classList.remove('msg-translating');
          }
        });
        return;
      }

      messageBatcher.recordSuccess();
      const payload = await response.json();
      const results = Lib.parseTranslationResponse(payload);

      // Map translations to DOM elements
      const resultMap = new Map();
      results.forEach(res => {
        if (res.id) resultMap.set(res.id, res);
      });

      batch.forEach(item => {
        const transEl = document.getElementById(`trans-${item.id}`);
        const noteEl = document.getElementById(`note-${item.id}`);
        const result = resultMap.get(item.id);

        if (result && result.zh) {
          if (transEl) {
            transEl.textContent = result.zh;
            transEl.classList.remove('msg-translating');
          }
          if (noteEl && result.note && result.note.trim()) {
            noteEl.textContent = `💡 ${result.note.trim()}`;
          }

          // Cache translation in state store
          const stored = state.messageStore.get(item.id);
          if (stored) {
            stored.zh = result.zh;
            stored.note = result.note || '';
          }
        } else {
          if (transEl) {
            transEl.textContent = '暂无翻译';
            transEl.classList.remove('msg-translating');
          }
        }
      });
    } catch (err) {
      messageBatcher.recordError(500);
      batch.forEach(item => {
        const transEl = document.getElementById(`trans-${item.id}`);
        if (transEl) {
          transEl.innerHTML = '<span class="msg-trans-error">⚠️ 网络连接异常</span>';
          transEl.classList.remove('msg-translating');
        }
      });
    }
  }

  /* ==========================================================================
     Chat View & Message Rendering
     ========================================================================== */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function appendChatMessage(parsed) {
    if (!parsed) return;

    if (elements.chatEmptyState) {
      elements.chatEmptyState.remove();
    }

    // Check if user was near bottom before adding
    const container = elements.chatMessages;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 70;

    // Store in message cache
    state.messageStore.set(parsed.id, {
      id: parsed.id,
      author: parsed.displayName,
      text: parsed.text,
      timestamp: parsed.timestamp,
      color: parsed.color,
      zh: '',
      note: '',
      replies: null
    });

    // Create message element
    const msgEl = document.createElement('div');
    msgEl.className = 'msg';
    msgEl.setAttribute('data-id', parsed.id);
    msgEl.setAttribute('role', 'button');
    msgEl.setAttribute('tabindex', '0');
    msgEl.setAttribute('title', '点击获取 3 种地道英文回复建议');

    const formattedTime = Lib.formatTime(parsed.timestamp);
    const readableColor = Lib.getReadableColor(parsed.color, '#a970ff');
    const safeAuthor = escapeHtml(parsed.displayName);
    const safeText = escapeHtml(parsed.text);

    msgEl.innerHTML = `
      <div class="msg-header">
        <span class="msg-time">${formattedTime}</span>
        <span class="msg-author" style="color: ${readableColor}">${safeAuthor}</span>
        <span class="msg-tap-hint">💬 回复建议</span>
      </div>
      <div class="msg-body">${safeText}</div>
      <div class="msg-meta-row">
        <div class="msg-translation" id="trans-${parsed.id}">
          <span class="msg-trans-tip">${state.apiKey ? "等待翻译..." : "未设置 key"}</span>
        </div>
        <div class="msg-note" id="note-${parsed.id}"></div>
      </div>
    `;

    // Tap to open reply suggestions
    msgEl.addEventListener('click', () => {
      openReplySuggestions(parsed.id);
    });

    container.appendChild(msgEl);

    // Queue for batch translation
    messageBatcher.add({
      id: parsed.id,
      text: parsed.text,
      username: parsed.displayName
    });

    // Cap message list at MAX_MESSAGES (300)
    while (container.querySelectorAll('.msg').length > MAX_MESSAGES) {
      const oldest = container.querySelector('.msg');
      if (oldest) {
        const oldestId = oldest.getAttribute('data-id');
        if (oldestId) state.messageStore.delete(oldestId);
        container.removeChild(oldest);
      }
    }

    // Auto-scroll handling
    if (isAtBottom) {
      container.scrollTop = container.scrollHeight;
      state.unreadCount = 0;
      updateScrollBottomButton();
    } else {
      state.unreadCount++;
      updateScrollBottomButton();
    }
  }

  function updateScrollBottomButton() {
    if (!elements.btnScrollBottom) return;
    const container = elements.chatMessages;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 70;

    if (isAtBottom) {
      elements.btnScrollBottom.classList.add('hidden');
      state.unreadCount = 0;
      elements.unreadCountBadge.classList.add('hidden');
    } else {
      elements.btnScrollBottom.classList.remove('hidden');
      if (state.unreadCount > 0) {
        elements.unreadCountBadge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
        elements.unreadCountBadge.classList.remove('hidden');
      } else {
        elements.unreadCountBadge.classList.add('hidden');
      }
    }
  }

  function scrollToBottom() {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    state.unreadCount = 0;
    updateScrollBottomButton();
  }

  /* ==========================================================================
     Reply Suggestions Bottom Sheet (3 Styles: Simple, Natural, Playful)
     ========================================================================== */
  async function openReplySuggestions(msgId) {
    const msg = state.messageStore.get(msgId);
    if (!msg) return;

    state.currentReplyMsgId = msgId;

    // Render source message details
    elements.sourceAuthor.textContent = msg.author;
    elements.sourceAuthor.style.color = Lib.getReadableColor(msg.color, '#a970ff');
    elements.sourceTime.textContent = Lib.formatTime(msg.timestamp);
    elements.sourceText.textContent = msg.text;
    elements.sourceTranslation.textContent = msg.zh ? `翻译：${msg.zh}` : '翻译生成中...';

    // Reset copy buttons status
    document.querySelectorAll('.btn-copy').forEach(btn => {
      btn.classList.remove('copied');
      const textSpan = btn.querySelector('.copy-text');
      if (textSpan) textSpan.textContent = '复制';
    });

    elements.replySheet.classList.remove('hidden');
    elements.replySheet.setAttribute('aria-hidden', 'false');

    // If replies already cached for this message, show them instantly
    if (msg.replies) {
      displayReplies(msg.replies);
      return;
    }

    // Otherwise, generate with Gemini
    await fetchReplySuggestions(msg);
  }

  function closeReplySheet() {
    elements.replySheet.classList.add('hidden');
    elements.replySheet.setAttribute('aria-hidden', 'true');
    state.currentReplyMsgId = null;
  }

  function displayReplies(replies) {
    elements.suggestionsLoading.classList.add('hidden');
    elements.suggestionsError.classList.add('hidden');
    elements.suggestionsCards.classList.remove('hidden');

    elements.replySimpleEn.textContent = replies.simple.en;
    elements.replySimpleZh.textContent = replies.simple.zhDesc;

    elements.replyNaturalEn.textContent = replies.natural.en;
    elements.replyNaturalZh.textContent = replies.natural.zhDesc;

    elements.replyPlayfulEn.textContent = replies.playful.en;
    elements.replyPlayfulZh.textContent = replies.playful.zhDesc;
  }

  async function fetchReplySuggestions(msg) {
    if (!state.apiKey) {
      elements.suggestionsLoading.classList.add('hidden');
      elements.suggestionsCards.classList.add('hidden');
      elements.suggestionsError.classList.remove('hidden');
      elements.suggestionsErrorText.textContent = '请先在右上角设置中输入 Gemini API Key';
      return;
    }

    elements.suggestionsLoading.classList.remove('hidden');
    elements.suggestionsCards.classList.add('hidden');
    elements.suggestionsError.classList.add('hidden');

    const prompt = Lib.buildReplyPrompt(msg.text, msg.author);

    try {
      const response = await requestGemini(prompt, state.apiKey, state.model);
      if (!response.ok) {
        throw new Error(`API 返回状态码 ${response.status}`);
      }

      const payload = await response.json();
      const parsed = Lib.parseReplyResponse(payload);

      // Cache replies
      msg.replies = parsed;

      // Only display if this modal is still open for the same message
      if (state.currentReplyMsgId === msg.id) {
        displayReplies(parsed);
      }
    } catch (err) {
      elements.suggestionsLoading.classList.add('hidden');
      elements.suggestionsCards.classList.add('hidden');
      elements.suggestionsError.classList.remove('hidden');
      elements.suggestionsErrorText.textContent = `生成失败: ${err.message}`;
    }
  }

  /* ==========================================================================
     Clipboard Copy with Fallback
     ========================================================================== */
  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // Fallback below
      }
    }

    // Fallback using textarea execCommand
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch (e) {
      return false;
    }
  }

  function handleCopyButtonClick(event) {
    const btn = event.currentTarget;
    const targetType = btn.getAttribute('data-target');
    let textToCopy = '';

    if (targetType === 'simple') {
      textToCopy = elements.replySimpleEn.textContent;
    } else if (targetType === 'natural') {
      textToCopy = elements.replyNaturalEn.textContent;
    } else if (targetType === 'playful') {
      textToCopy = elements.replyPlayfulEn.textContent;
    }

    if (!textToCopy) return;

    copyTextToClipboard(textToCopy).then(success => {
      if (success) {
        btn.classList.add('copied');
        const textSpan = btn.querySelector('.copy-text');
        if (textSpan) textSpan.textContent = '已复制 ✓';
        showToast(`已复制: "${textToCopy}"`);
        setTimeout(() => {
          btn.classList.remove('copied');
          if (textSpan) textSpan.textContent = '复制';
        }, 2500);
      } else {
        showToast('复制失败，请手动长按复制');
      }
    });
  }

  /* ==========================================================================
     Twitch IRC WebSocket Client (wss://irc-ws.chat.twitch.tv:443)
     ========================================================================== */
  function updateConnectionStatus(status, message) {
    if (!elements.statusDot || !elements.statusText) return;
    elements.statusDot.className = `status-dot ${status}`;
    elements.statusText.textContent = message;
  }

  function connectToTwitch(channel) {
    // Clear any existing reconnect timers & socket
    if (state.wsReconnectTimer) {
      clearTimeout(state.wsReconnectTimer);
      state.wsReconnectTimer = null;
    }
    if (state.ws) {
      try {
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.onmessage = null;
        state.ws.close();
      } catch (_) {}
      state.ws = null;
    }

    const normChannel = Lib.normalizeChannel(channel);
    state.channel = normChannel;
    elements.channelInput.value = normChannel;

    updateConnectionStatus('connecting', `正在连接 #${normChannel}...`);

    try {
      const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      state.ws = ws;

      ws.onopen = function () {
        state.wsReconnectAttempt = 0;
        updateConnectionStatus('connected', `#${normChannel} (已连接)`);

        // Send authentication & join commands
        const commands = Lib.buildAuthCommands(normChannel);
        commands.forEach(cmd => {
          ws.send(cmd + '\r\n');
        });
      };

      ws.onmessage = function (event) {
        if (!event.data || typeof event.data !== 'string') return;

        const lines = event.data.split('\r\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Respond to PING with PONG
          if (line.startsWith('PING')) {
            const pongReply = line.replace('PING', 'PONG') + '\r\n';
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(pongReply);
            }
            continue;
          }

          // Parse chat message
          if (line.includes('PRIVMSG')) {
            const parsed = Lib.parsePrivmsg(line);
            if (parsed) {
              appendChatMessage(parsed);
            }
          }
        }
      };

      ws.onerror = function (err) {
        console.warn('Twitch WebSocket encountered an error:', err);
      };

      ws.onclose = function () {
        state.ws = null;
        scheduleReconnect();
      };
    } catch (err) {
      console.error('Failed to instantiate WebSocket:', err);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    state.wsReconnectAttempt++;
    const delay = Lib.calculateBackoff(state.wsReconnectAttempt - 1, 2000, 20000);
    const sec = Math.round(delay / 1000);

    updateConnectionStatus('connecting', `连接断开，${sec} 秒后重试...`);

    state.wsReconnectTimer = setTimeout(() => {
      connectToTwitch(state.channel);
    }, delay);
  }

  function switchChannel(newChannel) {
    const normalized = Lib.normalizeChannel(newChannel);
    if (!normalized) return;

    // Update URL query param without page reload
    const url = new URL(window.location.href);
    url.searchParams.set('channel', normalized);
    window.history.replaceState({}, '', url.toString());

    // Reset messages and reconnect
    elements.chatMessages.innerHTML = '';
    state.messageStore.clear();
    messageBatcher.clear();

    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'chat-empty-state';
    emptyNotice.id = 'chat-empty-state';
    emptyNotice.innerHTML = `
      <div class="empty-icon">🎮</div>
      <h3>已切换至频道 #${escapeHtml(normalized)}</h3>
      <p>正在接收实时聊天消息并批量翻译...</p>
    `;
    elements.chatMessages.appendChild(emptyNotice);

    connectToTwitch(normalized);
  }

  /* ==========================================================================
     Event Bindings & Initialization
     ========================================================================== */
  function bindEvents() {
    // Channel change form
    elements.channelForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = elements.channelInput.value.trim();
      if (val) {
        switchChannel(val);
      }
    });

    // Settings modal triggers
    elements.btnOpenSettings.addEventListener('click', openSettingsModal);
    elements.btnBannerSettings.addEventListener('click', openSettingsModal);
    elements.btnCloseSettings.addEventListener('click', closeSettingsModal);
    elements.btnSaveSettings.addEventListener('click', saveSettings);
    elements.btnClearSettings.addEventListener('click', clearSettings);
    elements.btnTestKey.addEventListener('click', testGeminiApiKey);

    // Toggle API Key password visibility
    elements.btnToggleKeyVisibility.addEventListener('click', () => {
      const type = elements.inputApiKey.getAttribute('type');
      elements.inputApiKey.setAttribute('type', type === 'password' ? 'text' : 'password');
    });

    // Model dropdown change
    elements.selectModel.addEventListener('change', () => {
      if (elements.selectModel.value === 'custom') {
        elements.inputCustomModel.classList.remove('hidden');
        elements.inputCustomModel.focus();
      } else {
        elements.inputCustomModel.classList.add('hidden');
      }
    });

    // Settings backdrop click to close
    elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === elements.settingsModal) {
        closeSettingsModal();
      }
    });

    // Reply suggestions sheet triggers
    elements.btnCloseSheet.addEventListener('click', closeReplySheet);
    elements.replySheet.addEventListener('click', (e) => {
      if (e.target === elements.replySheet) {
        closeReplySheet();
      }
    });
    elements.btnRetrySuggestions.addEventListener('click', () => {
      if (state.currentReplyMsgId) {
        const msg = state.messageStore.get(state.currentReplyMsgId);
        if (msg) fetchReplySuggestions(msg);
      }
    });

    // Copy reply buttons
    document.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', handleCopyButtonClick);
    });

    // Chat auto-scroll tracking
    elements.chatMessages.addEventListener('scroll', () => {
      updateScrollBottomButton();
    });

    elements.btnScrollBottom.addEventListener('click', scrollToBottom);

    // Keyboard shortcuts (Escape closes modals)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!elements.settingsModal.classList.contains('hidden')) {
          closeSettingsModal();
        } else if (!elements.replySheet.classList.contains('hidden')) {
          closeReplySheet();
        }
      }
    });
  }

  function init() {
    // Parse channel from URL query string
    const targetChannel = Lib.parseChannelFromQuery(window.location.search, DEFAULT_CHANNEL);

    bindEvents();
    updateKeyBannerState();
    connectToTwitch(targetChannel);
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
