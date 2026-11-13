'use strict';
/**
 * Лёгкий клиентский API для 4 независимых ассистентов админ-панели Mandarin Pro.
 * Провайдеры:
 *   dify   — Dify API (POST /chat-messages, ключ приложения Dify)
 *   openai — любой OpenAI-совместимый бэкенд (OpenAI, LiteLLM, Groq, DeepSeek...)
 *   claude — Anthropic Messages API (прямой или через свой шлюз)
 * Ключи хранятся только на сервере, клиенту отдаются лишь маска и признак наличия.
 */

const express = require('express');
const { agentKey } = require('./mem0-client.js');
const { extractLangflowText } = require('./langflow-client.js');

const DEFAULT_ASSISTANTS = [
    {
        id: 'admin', emoji: '🛡️', name: 'Помощник администратора',
        provider: 'dify', baseUrl: 'https://api.dify.ai/v1', model: '',
        system: 'Ты — помощник администратора школы Mandarin Pro. Отвечай кратко и по делу на русском языке. Помогай с вопросами управления пользователями, группами, уведомлениями и настройками панели. Не выдумывай факты: если чего-то не знаешь — честно скажи об этом.'
    },
    {
        id: 'method', emoji: '📚', name: 'Методист',
        provider: 'dify', baseUrl: 'https://api.dify.ai/v1', model: '',
        system: 'Ты — методист по китайскому языку (HSK 1–4). Помогай составлять уроки, тесты, домашние задания и разбор ошибок учеников. Отвечай на русском языке, иероглифы приводи с пиньинем и переводом. Не выдавай непроверенные данные за факты.'
    },
    {
        id: 'finance', emoji: '💰', name: 'Финансовый аналитик',
        provider: 'dify', baseUrl: 'https://api.dify.ai/v1', model: '',
        system: 'Ты — финансовый аналитик внутриигрового банка Mandarin Pro (вклады, инвестиции, купоны, промокоды, курсы валют). Помогай считать доходность, объяснять механики и предлагать акции. Отвечай по-русски, считай аккуратно, сомнения обозначай явно.'
    },
    {
        id: 'writer', emoji: '✍️', name: 'Копирайтер',
        provider: 'dify', baseUrl: 'https://api.dify.ai/v1', model: '',
        system: 'Ты — копирайтер Mandarin Pro. Пиши объявления, поздравления, тексты для родителей и учеников, анонсы событий. Стиль тёплый и ясный, без канцелярита. Отвечай на русском языке.'
    }
];

const PROVIDERS = ['dify', 'openai', 'claude', 'langflow', 'openwebui'];
const HISTORY_LIMIT = 50;
const UPSTREAM_TIMEOUT_MS = 120000;

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

function maskKey(key) {
    const k = String(key || '');
    if (!k) return '';
    if (k.length <= 8) return '••••••';
    return k.slice(0, 3) + '••••' + k.slice(-4);
}

function trimErr(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function scrubKey(text, key) {
    const t = String(text || '');
    const k = String(key || '');
    if (!k) return t;
    return t.split(k).join('***');
}

function normBase(baseUrl, fallback) {
    let b = String(baseUrl || '').trim() || fallback;
    b = b.replace(/\/+$/, '');
    return b;
}

function ensureState(db) {
    if (!db.aiAssistants || typeof db.aiAssistants !== 'object') db.aiAssistants = {};
    const A = db.aiAssistants;
    if (!A.configs || typeof A.configs !== 'object') A.configs = {};
    if (!A.chats || typeof A.chats !== 'object') A.chats = {};
    if (!A.convIds || typeof A.convIds !== 'object') A.convIds = {};
    for (const d of DEFAULT_ASSISTANTS) {
        if (!A.configs[d.id] || typeof A.configs[d.id] !== 'object') {
            A.configs[d.id] = {
                id: d.id, name: d.name, emoji: d.emoji, provider: d.provider,
                baseUrl: d.baseUrl, apiKey: '', model: d.model,
                system: d.system, temperature: 0.7, maxTokens: 2048, memory: true
            };
        }
        if (!Array.isArray(A.chats[d.id])) A.chats[d.id] = [];
    }
    return A;
}

function publicConfig(cfg) {
    return {
        id: cfg.id,
        name: cfg.name,
        emoji: cfg.emoji,
        provider: PROVIDERS.includes(cfg.provider) ? cfg.provider : 'dify',
        baseUrl: cfg.baseUrl || '',
        model: cfg.model || '',
        system: cfg.system || '',
        temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
        maxTokens: typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 2048,
        memory: cfg.memory !== false,
        hasKey: !!cfg.apiKey,
        keyMask: maskKey(cfg.apiKey)
    };
}

async function readJson(r) {
    const text = await r.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        return { raw: trimErr(text) };
    }
}

function upstreamMessage(data, status, key) {
    const m = (data && (data.detail || data.message || (data.error && (data.error.message || data.error)) || data.error || data.raw)) || '';
    const s = typeof m === 'string' ? trimErr(m) : trimErr(JSON.stringify(m));
    return scrubKey(s || ('HTTP ' + status), key);
}

/** Один вызов модели. chatState = {convId} для dify; history = [{role,content}] для openai/claude. */
async function callProvider(cfg, history, message, chatState, fetchImpl, userTag) {
    const provider = String(cfg.provider || 'dify').toLowerCase();
    const key = String(cfg.apiKey || '');
    if (!key && provider !== 'langflow' && provider !== 'openwebui') throw httpError(400, 'API-ключ не задан — откройте настройки ассистента');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
        if (provider === 'dify') {
            const base = normBase(cfg.baseUrl, 'https://api.dify.ai/v1');
            const body = {
                inputs: {},
                query: String(message),
                response_mode: 'blocking',
                user: userTag || 'mandarin-admin'
            };
            if (chatState && chatState.convId) body.conversation_id = chatState.convId;
            const r = await fetchImpl(base + '/chat-messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                body: JSON.stringify(body),
                signal: ctrl.signal
            });
            const data = await readJson(r);
            if (!r.ok) throw httpError(r.status >= 500 ? 502 : r.status, 'Dify: ' + upstreamMessage(data, r.status, key));
            if (chatState && data.conversation_id) chatState.convId = String(data.conversation_id);
            const answer = data && (data.answer != null ? data.answer : (data.data && data.data.answer));
            return { reply: String(answer != null ? answer : ''), provider: 'dify' };
        }

        if (provider === 'openai' || provider === 'openwebui') {
            const isOwui = provider === 'openwebui';
            const base = normBase(cfg.baseUrl, isOwui ? 'http://127.0.0.1:8080/api' : 'https://api.openai.com/v1');
            const model = String(cfg.model || (isOwui ? '' : 'gpt-4o-mini')).trim();
            if (isOwui && !model) throw httpError(400, 'Не выбрана модель Open WebUI (поле «Модель / ID флоу»)');
            const msgs = [];
            if (cfg.system) msgs.push({ role: 'system', content: String(cfg.system) });
            for (const m of (history || []).slice(-20)) {
                if (m && (m.role === 'user' || m.role === 'assistant')) msgs.push({ role: m.role, content: String(m.content || '') });
            }
            msgs.push({ role: 'user', content: String(message) });
            const headers = { 'Content-Type': 'application/json' };
            if (key) headers['Authorization'] = 'Bearer ' + key;
            const r = await fetchImpl(base + '/chat/completions', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: model || 'gpt-4o-mini',
                    messages: msgs,
                    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
                    max_tokens: typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 2048
                }),
                signal: ctrl.signal
            });
            const data = await readJson(r);
            if (!r.ok) throw httpError(r.status >= 500 ? 502 : r.status, (isOwui ? 'Open WebUI: ' : 'OpenAI-совместимый API: ') + upstreamMessage(data, r.status, key));
            const choice = data && data.choices && data.choices[0];
            const content = choice && choice.message && choice.message.content;
            if (content == null) throw httpError(502, 'Пустой ответ модели');
            return { reply: String(content), provider };
        }

        if (provider === 'claude') {
            let base = normBase(cfg.baseUrl, 'https://api.anthropic.com');
            base = base.replace(/\/v1$/i, '');
            const msgs = [];
            for (const m of (history || []).slice(-20)) {
                if (m && (m.role === 'user' || m.role === 'assistant')) msgs.push({ role: m.role, content: String(m.content || '') });
            }
            msgs.push({ role: 'user', content: String(message) });
            const payload = {
                model: String(cfg.model || 'claude-sonnet-4-5'),
                max_tokens: typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 2048,
                messages: msgs
            };
            if (cfg.system) payload.system = String(cfg.system);
            const r = await fetchImpl(base + '/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(payload),
                signal: ctrl.signal
            });
            const data = await readJson(r);
            if (!r.ok) throw httpError(r.status >= 500 ? 502 : r.status, 'Anthropic: ' + upstreamMessage(data, r.status, key));
            const blocks = (data && data.content) || [];
            const reply = blocks.map(b => (b && b.type === 'text') ? String(b.text || '') : '').join('\n').trim();
            if (!reply) throw httpError(502, 'Пустой ответ модели');
            return { reply, provider: 'claude' };
        }

        if (provider === 'langflow') {
            const flowId = String(cfg.model || '').trim();
            if (!flowId) throw httpError(400, 'Не задан ID флоу Langflow (поле «Модель»)');
            const base = normBase(cfg.baseUrl, 'http://127.0.0.1:7860');
            const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
            if (key) headers['x-api-key'] = key;
            const r = await fetchImpl(base + '/api/v1/run/' + encodeURIComponent(flowId), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    input_value: String(message),
                    input_type: 'chat',
                    output_type: 'chat',
                    session_id: (chatState && chatState.sessionId) || userTag || 'mandarin-admin'
                }),
                signal: ctrl.signal
            });
            const data = await readJson(r);
            if (!r.ok) throw httpError(r.status >= 500 ? 502 : r.status, 'Langflow: ' + upstreamMessage(data, r.status, key));
            const reply = extractLangflowText(data).trim();
            if (!reply) throw httpError(502, 'Langflow: пустой ответ флоу');
            return { reply, provider: 'langflow' };
        }

        throw httpError(400, 'Неизвестный провайдер: ' + provider);
    } catch (e) {
        if (e && e.name === 'AbortError') throw httpError(504, 'Модель не ответила за ' + Math.round(UPSTREAM_TIMEOUT_MS / 1000) + ' с');
        if (e && e.status) throw e;
        throw httpError(502, 'Сетевая ошибка провайдера: ' + scrubKey(trimErr(e && e.message), key));
    } finally {
        clearTimeout(timer);
    }
}

function createAssistantsRouter(opts) {
    const { validateToken, getDb, saveDB, fetchImpl, mem0 } = opts || {};
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    const router = express.Router();

    router.use((req, res, next) => {
        const h = req.headers || {};
        let token = '';
        const auth = String(h['x-admin-token'] || h['authorization'] || '');
        if (/^bearer\s+/i.test(auth)) token = auth.replace(/^bearer\s+/i, '').trim();
        else if (auth) token = auth.trim();
        if (!token && h.cookie) {
            token = (String(h.cookie).split(';').map(x => x.trim()).find(x => x.startsWith('pb_admin=')) || '').slice(9);
        }
        if (!token || typeof validateToken !== 'function' || !validateToken(token)) {
            res.status(403).json({ ok: false, error: 'Нет админ-доступа' });
            return;
        }
        next();
    });

    router.get('/state', (req, res) => {
        const A = ensureState(getDb());
        res.json({
            ok: true,
            assistants: DEFAULT_ASSISTANTS.map(d => publicConfig(A.configs[d.id])),
            chats: A.chats
        });
    });

    router.post('/config', (req, res) => {
        const A = ensureState(getDb());
        const body = req.body || {};
        const id = String(body.id || '');
        const cfg = A.configs[id];
        if (!cfg) {
            res.status(404).json({ ok: false, error: 'Ассистент не найден' });
            return;
        }
        if (body.name != null) cfg.name = String(body.name).slice(0, 80) || cfg.name;
        if (body.emoji != null) cfg.emoji = String(body.emoji).slice(0, 8) || cfg.emoji;
        if (body.provider != null) {
            const p = String(body.provider).toLowerCase();
            if (!PROVIDERS.includes(p)) {
                res.status(400).json({ ok: false, error: 'Неизвестный провайдер' });
                return;
            }
            cfg.provider = p;
        }
        if (body.baseUrl != null) cfg.baseUrl = String(body.baseUrl).trim().slice(0, 300);
        if (body.model != null) cfg.model = String(body.model).trim().slice(0, 120);
        if (body.system != null) cfg.system = String(body.system).slice(0, 8000);
        if (body.temperature != null) {
            const t = Number(body.temperature);
            if (Number.isFinite(t)) cfg.temperature = Math.min(2, Math.max(0, t));
        }
        if (body.maxTokens != null) {
            const n = parseInt(body.maxTokens, 10);
            if (Number.isFinite(n)) cfg.maxTokens = Math.min(32000, Math.max(256, n));
        }
        if (body.memory != null) cfg.memory = !(body.memory === false || body.memory === 'false' || body.memory === 0);
        if (body.clearKey) cfg.apiKey = '';
        else if (body.apiKey != null && String(body.apiKey).length > 0) cfg.apiKey = String(body.apiKey).slice(0, 500);
        saveDB();
        res.json({ ok: true, assistant: publicConfig(cfg) });
    });

    router.post('/chat', async (req, res) => {
        try {
            const A = ensureState(getDb());
            const body = req.body || {};
            const id = String(body.id || '');
            const cfg = A.configs[id];
            if (!cfg) throw httpError(404, 'Ассистент не найден');
            const message = String(body.message || '').trim();
            if (!message) throw httpError(400, 'Пустое сообщение');
            if (message.length > 32000) throw httpError(400, 'Сообщение слишком длинное');

            const history = Array.isArray(A.chats[id]) ? A.chats[id] : [];
            if (!A.convIds || typeof A.convIds !== 'object') A.convIds = {};
            const chatState = { convId: A.convIds[id] || '', sessionId: agentKey(id) };

            // Память mem0: факты из прошлых диалогов дописываем в контекст (сбой памяти не блокирует чат)
            const useMem = !!(mem0 && typeof mem0.isEnabled === 'function' && mem0.isEnabled() && cfg.memory !== false);
            let memFacts = '';
            if (useMem) {
                try {
                    const sr = await mem0.search(message, { agent_id: agentKey(id) }, 5);
                    memFacts = ((sr && sr.results) || [])
                        .map(r => '- ' + String(r.memory || '').replace(/\s+/g, ' ').trim())
                        .filter(Boolean).join('\n');
                } catch (e) { memFacts = ''; }
            }

            const providerName = String(cfg.provider || '').toLowerCase();
            const usesQueryContext = providerName === 'dify' || providerName === 'langflow';
            const runCfg = (memFacts && !usesQueryContext)
                ? Object.assign({}, cfg, {
                    system: (cfg.system ? cfg.system + '\n\n' : '') +
                        'Факты из памяти о прошлых диалогах (учитывай, не цитируй дословно):\n' + memFacts
                })
                : cfg;
            const runMessage = (memFacts && usesQueryContext)
                ? 'Факты из памяти о прошлых диалогах:\n' + memFacts + '\n\nЗапрос: ' + message
                : message;

            const result = await callProvider(runCfg, history, runMessage, chatState, doFetch, 'mandarin-admin');
            if (chatState.convId) A.convIds[id] = chatState.convId;

            history.push({ role: 'user', content: message, ts: Date.now() });
            history.push({ role: 'assistant', content: result.reply, ts: Date.now() });
            while (history.length > HISTORY_LIMIT) history.shift();
            A.chats[id] = history;
            saveDB();
            if (useMem) {
                Promise.resolve(mem0.add(
                    [{ role: 'user', content: message }, { role: 'assistant', content: result.reply }],
                    { agent_id: agentKey(id), user_id: 'mandarin-admin' },
                    { assistant: cfg.name || id }
                )).catch(() => { });
            }
            res.json({ ok: true, reply: result.reply, provider: result.provider, convId: chatState.convId || '' });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) || 'Ошибка' });
        }
    });

    router.post('/test', async (req, res) => {
        try {
            const A = ensureState(getDb());
            const id = String((req.body && req.body.id) || '');
            const cfg = A.configs[id];
            if (!cfg) throw httpError(404, 'Ассистент не найден');
            const result = await callProvider(cfg, [], 'Ответь одним словом: готов', { convId: '' }, doFetch, 'mandarin-admin-check');
            res.json({ ok: true, reply: trimErr(result.reply).slice(0, 200) });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) || 'Ошибка' });
        }
    });

    router.post('/clear', (req, res) => {
        const A = ensureState(getDb());
        const id = String((req.body && req.body.id) || '');
        if (!A.configs[id]) {
            res.status(404).json({ ok: false, error: 'Ассистент не найден' });
            return;
        }
        A.chats[id] = [];
        if (A.convIds) A.convIds[id] = '';
        saveDB();
        res.json({ ok: true });
    });

    return router;
}

module.exports = { createAssistantsRouter, DEFAULT_ASSISTANTS, callProvider, maskKey };
