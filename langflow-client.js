'use strict';
/**
 * Лёгкий клиент Langflow (REST API v1) для 4 ассистентов Mandarin Pro.
 * Без SDK и без интеграции репозитория: чистый fetch.
 * Run:  POST {base}/api/v1/run/{flow_id}   body {input_value, input_type, output_type, session_id}
 * List: GET  {base}/api/v1/flows/
 * Auth: заголовок x-api-key: <key> (для локального Langflow без авторизации ключ можно не задавать).
 */

const express = require('express');

const LANGFLOW_DEFAULT_BASE = 'http://127.0.0.1:7860';
const LANGFLOW_TIMEOUT_MS = 120000;

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

/** Текст ответа из разных форматов Langflow (results.message.text / data.text / artifacts / outputs[].message). */
function extractLangflowText(data) {
    if (data == null) return '';
    if (typeof data === 'string') return data;
    const pickMsg = (msg) => {
        if (!msg || typeof msg !== 'object') return '';
        if (typeof msg.text === 'string' && msg.text) return msg.text;
        if (msg.data && typeof msg.data.text === 'string' && msg.data.text) return msg.data.text;
        return '';
    };
    try {
        const outs = Array.isArray(data.outputs) ? data.outputs : [];
        for (const o of outs) {
            const inner = Array.isArray(o && o.outputs) ? o.outputs : [];
            for (const io of inner) {
                const r = io && io.results;
                if (r && r.message) {
                    const t = pickMsg(r.message);
                    if (t) return t;
                }
                const art = io && io.artifacts;
                if (art && art.message) {
                    const t = pickMsg(art.message);
                    if (t) return t;
                }
                if (io && io.message) {
                    const t = pickMsg(io.message);
                    if (t) return t;
                }
            }
            if (o && o.outputs && typeof o.outputs === 'string') return o.outputs;
        }
        if (data.message) {
            const t = pickMsg(data.message);
            if (t) return t;
        }
        if (typeof data.result === 'string' && data.result) return data.result;
    } catch (e) { /* fallthrough */ }
    return '';
}

/** cfg: {baseUrl, apiKey}. */
function createLangflowClient(opts) {
    const { fetchImpl } = opts || {};
    const doFetch = fetchImpl || ((...a) => fetch(...a));

    function normCfg(cfg) {
        const c = cfg || {};
        return {
            baseUrl: String(c.baseUrl || '').trim().replace(/\/+$/, '') || LANGFLOW_DEFAULT_BASE,
            apiKey: String(c.apiKey || '')
        };
    }

    async function req(cfgIn, method, path, body) {
        const c = normCfg(cfgIn);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), LANGFLOW_TIMEOUT_MS);
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            if (c.apiKey) headers['x-api-key'] = c.apiKey;
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
                const e = new Error('Langflow: ' + scrubKey(trimErr(typeof m === 'string' ? m : JSON.stringify(m)), c.apiKey));
                e.status = r.status >= 500 ? 502 : r.status;
                throw e;
            }
            return data;
        } catch (e) {
            if (e && e.name === 'AbortError') {
                const err = new Error('Langflow: таймаут ' + Math.round(LANGFLOW_TIMEOUT_MS / 1000) + ' с');
                err.status = 504;
                throw err;
            }
            if (e && e.status) throw e;
            const err = new Error('Langflow: сетевая ошибка: ' + scrubKey(trimErr(e && e.message), normCfg(cfgIn).apiKey));
            err.status = 502;
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        /** POST /api/v1/run/{flowId} — запуск флоу. sessionId даёт непрерывность диалога внутри Langflow. */
        runFlow: async (cfg, flowId, input, sessionId) => {
            const data = await req(cfg, 'POST', '/api/v1/run/' + encodeURIComponent(String(flowId || '')), {
                input_value: String(input || ''),
                input_type: 'chat',
                output_type: 'chat',
                session_id: sessionId ? String(sessionId) : undefined
            });
            return extractLangflowText(data);
        },
        /** GET /api/v1/flows/ — список флоу (id, name) для подстановки в настройки. */
        listFlows: async (cfg) => {
            const data = await req(cfg, 'GET', '/api/v1/flows/?page=1&size=100');
            const arr = Array.isArray(data) ? data
                : (Array.isArray(data && data.flows) ? data.flows
                    : (Array.isArray(data && data.items) ? data.items
                        : (Array.isArray(data && data.results) ? data.results
                            : (Array.isArray(data && data.data) ? data.data : []))));
            return arr.map(f => ({ id: String((f && (f.id || f.flow_id)) || ''), name: String((f && (f.name || f.title)) || '') })).filter(f => f.id);
        },
        _req: req,
        extractLangflowText
    };
}

/** Роутер /api/langflow — только админ. Подключение берётся из настроек ассистента. */
function createLangflowRouter(opts) {
    const { validateToken, getDb, fetchImpl } = opts || {};
    const router = express.Router();
    const client = createLangflowClient({ fetchImpl });

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

    router.get('/flows', async (req, res) => {
        try {
            const id = String((req.query && req.query.id) || '');
            const db = getDb();
            const cfg = db && db.aiAssistants && db.aiAssistants.configs && db.aiAssistants.configs[id];
            if (!cfg) { res.status(404).json({ ok: false, error: 'Ассистент не найден' }); return; }
            const flows = await client.listFlows({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
            res.json({ ok: true, flows });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) });
        }
    });

    return router;
}

module.exports = { createLangflowClient, createLangflowRouter, extractLangflowText, maskKey, LANGFLOW_DEFAULT_BASE };
