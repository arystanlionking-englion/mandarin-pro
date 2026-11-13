'use strict';
/**
 * Лёгкий клиент Open WebUI (REST API) для 4 ассистентов Mandarin Pro.
 * Без SDK и без интеграции репозитория: чистый fetch.
 * Models: GET  {base}/models
 * Chat:   POST {base}/chat/completions  (OpenAI-совместимый формат)
 * Auth:   Authorization: Bearer <api-key> (sk-…); для инстанса без авторизации ключ можно не задавать.
 * Base URL по умолчанию: http://127.0.0.1:8080/api
 */

const express = require('express');

const OPENWEBUI_DEFAULT_BASE = 'http://127.0.0.1:8080/api';
const OPENWEBUI_TIMEOUT_MS = 30000;

function maskKey(key) {
    const k = String(key || '');
    if (!k) return '';
    if (k.length <= 8) return '••••••';
    return k.slice(0, 3) + '••••' + k.slice(-4);
}

function scrubKey(text, key) {
    const t = String(text || '');
    const k = String(key || '');
    if (!k) return t;
    return t.split(k).join('***');
}

function trimErr(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** cfg: {baseUrl, apiKey}. */
function createOpenWebUIClient(opts) {
    const { fetchImpl } = opts || {};
    const doFetch = fetchImpl || ((...a) => fetch(...a));

    function normCfg(cfg) {
        const c = cfg || {};
        return {
            baseUrl: String(c.baseUrl || '').trim().replace(/\/+$/, '') || OPENWEBUI_DEFAULT_BASE,
            apiKey: String(c.apiKey || '')
        };
    }

    async function req(cfgIn, method, path, body) {
        const c = normCfg(cfgIn);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), OPENWEBUI_TIMEOUT_MS);
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            if (c.apiKey) headers['Authorization'] = 'Bearer ' + c.apiKey;
            const r = await doFetch(c.baseUrl + path, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: ctrl.signal
            });
            const text = await r.text();
            let data = {};
            try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
            if (!r.ok) {
                const m = (data && (data.detail || data.error || data.message || data.raw)) || ('HTTP ' + r.status);
                const msg = typeof m === 'string' ? m : (m && m.message) ? m.message : JSON.stringify(m);
                const e = new Error('Open WebUI: ' + scrubKey(trimErr(msg), c.apiKey));
                e.status = r.status >= 500 ? 502 : r.status;
                throw e;
            }
            return data;
        } catch (e) {
            if (e && e.name === 'AbortError') {
                const err = new Error('Open WebUI: таймаут ' + Math.round(OPENWEBUI_TIMEOUT_MS / 1000) + ' с');
                err.status = 504;
                throw err;
            }
            if (e && e.status) throw e;
            const err = new Error('Open WebUI: сетевая ошибка: ' + scrubKey(trimErr(e && e.message), normCfg(cfgIn).apiKey));
            err.status = 502;
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        /** GET /models — список моделей (OpenAI-формат: {object:'list', data:[{id,...}]}). */
        listModels: async (cfg) => {
            const data = await req(cfg, 'GET', '/models');
            const arr = Array.isArray(data) ? data
                : (Array.isArray(data && data.data) ? data.data
                    : (Array.isArray(data && data.models) ? data.models
                        : (Array.isArray(data && data.results) ? data.results : [])));
            return arr.map(m => ({
                id: String((m && (m.id || m.name)) || ''),
                name: String((m && (m.name || m.id)) || '')
            })).filter(m => m.id);
        },
        /** POST /chat/completions — OpenAI-совместимый запрос (для проверки связи). */
        chat: async (cfg, model, messages) => {
            const data = await req(cfg, 'POST', '/chat/completions', {
                model: String(model || ''),
                messages: (messages || []).map(m => ({ role: m.role, content: String(m.content || '') }))
            });
            const choice = data && data.choices && data.choices[0];
            return String((choice && choice.message && choice.message.content) != null ? choice.message.content : '');
        },
        _req: req
    };
}

/** Роутер /api/openwebui — только админ. Подключение берётся из настроек ассистента. */
function createOpenWebUIRouter(opts) {
    const { validateToken, getDb, fetchImpl } = opts || {};
    const router = express.Router();
    const client = createOpenWebUIClient({ fetchImpl });

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

    router.get('/models', async (req, res) => {
        try {
            const id = String((req.query && req.query.id) || '');
            const db = getDb();
            const cfg = db && db.aiAssistants && db.aiAssistants.configs && db.aiAssistants.configs[id];
            if (!cfg) { res.status(404).json({ ok: false, error: 'Ассистент не найден' }); return; }
            const models = await client.listModels({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
            res.json({ ok: true, models });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) });
        }
    });

    return router;
}

module.exports = { createOpenWebUIClient, createOpenWebUIRouter, maskKey, OPENWEBUI_DEFAULT_BASE };
