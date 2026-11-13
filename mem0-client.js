'use strict';
/**
 * Лёгкий клиент mem0 (REST API Platform V3) для 4 ассистентов Mandarin Pro.
 * Без SDK: чистый fetch. Ключ хранится только на сервере и не отдаётся клиенту.
 * API: POST /v3/memories/add/, POST /v3/memories/search/, POST /v3/memories/, DELETE /v1/memories/{id}/
 * Auth: Authorization: Token <api-key>
 */

const express = require('express');

const MEM0_DEFAULT_BASE = 'https://api.mem0.ai';
const MEM0_TIMEOUT_MS = 30000;

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

/** agent_id ассистента — изоляция памяти между ассистентами */
function agentKey(id) {
    return 'mandarin-asst-' + String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

function createMem0Client(opts) {
    const { getCfg, fetchImpl } = opts || {};
    const doFetch = fetchImpl || ((...a) => fetch(...a));

    function cfg() {
        const c = (typeof getCfg === 'function' && getCfg()) || {};
        return {
            baseUrl: String(c.baseUrl || '').trim().replace(/\/+$/, '') || MEM0_DEFAULT_BASE,
            apiKey: String(c.apiKey || ''),
            enabled: !!c.enabled
        };
    }

    async function req(method, path, body) {
        const c = cfg();
        if (!c.apiKey) {
            const e = new Error('mem0: API-ключ не задан');
            e.status = 400;
            throw e;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), MEM0_TIMEOUT_MS);
        try {
            const r = await doFetch(c.baseUrl + path, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': 'Token ' + c.apiKey
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: ctrl.signal
            });
            const text = await r.text();
            let data = {};
            try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
            if (!r.ok) {
                const m = (data && (data.detail || data.error || (data.details && (data.details.message || data.details)) || data.message || data.raw)) || ('HTTP ' + r.status);
                const e = new Error('mem0: ' + scrubKey(trimErr(typeof m === 'string' ? m : JSON.stringify(m)), c.apiKey));
                e.status = r.status >= 500 ? 502 : r.status;
                throw e;
            }
            return data;
        } catch (e) {
            if (e && e.name === 'AbortError') {
                const err = new Error('mem0: таймаут ' + Math.round(MEM0_TIMEOUT_MS / 1000) + ' с');
                err.status = 504;
                throw err;
            }
            if (e && e.status) throw e;
            const err = new Error('mem0: сетевая ошибка: ' + scrubKey(trimErr(e && e.message), cfg().apiKey));
            err.status = 502;
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        isEnabled: () => cfg().enabled && !!cfg().apiKey,
        /** POST /v3/memories/add/ — ids: {user_id|agent_id|run_id|app_id} */
        add: (messages, ids, metadata) => req('POST', '/v3/memories/add/', {
            messages: (messages || []).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 8000) })),
            ...(ids || {}),
            metadata: metadata || {},
            infer: true
        }),
        /** POST /v3/memories/search/ — filters обязателен и содержит agent_id */
        search: (query, filters, topK) => req('POST', '/v3/memories/search/', {
            query: String(query || '').slice(0, 4000),
            filters: filters || {},
            top_k: topK || 5
        }),
        /** POST /v3/memories/?page=&page_size= — список с фильтром */
        list: (filters, page, pageSize) => req('POST', '/v3/memories/?page=' + (page || 1) + '&page_size=' + (pageSize || 50), {
            filters: filters || {}
        }),
        /** DELETE /v1/memories/{id}/ */
        deleteOne: (memoryId) => req('DELETE', '/v1/memories/' + encodeURIComponent(String(memoryId || '')) + '/'),
        _req: req
    };
}

function ensureMem0State(db) {
    if (!db.aiAssistants || typeof db.aiAssistants !== 'object') db.aiAssistants = {};
    if (!db.aiAssistants.mem0 || typeof db.aiAssistants.mem0 !== 'object') {
        db.aiAssistants.mem0 = { enabled: false, baseUrl: MEM0_DEFAULT_BASE, apiKey: '' };
    }
    const m = db.aiAssistants.mem0;
    if (typeof m.enabled !== 'boolean') m.enabled = false;
    if (!m.baseUrl) m.baseUrl = MEM0_DEFAULT_BASE;
    if (typeof m.apiKey !== 'string') m.apiKey = '';
    return m;
}

/** Роутер /api/mem0 — только админ (validateToken как у /api/assistants). */
function createMem0Router(opts) {
    const { validateToken, getDb, saveDB, fetchImpl } = opts || {};
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

    function client() {
        return createMem0Client({ getCfg: () => ensureMem0State(getDb()), fetchImpl });
    }

    router.get('/state', (req, res) => {
        const m = ensureMem0State(getDb());
        res.json({
            ok: true,
            mem0: {
                enabled: m.enabled,
                baseUrl: m.baseUrl,
                hasKey: !!m.apiKey,
                keyMask: maskKey(m.apiKey)
            }
        });
    });

    router.post('/config', (req, res) => {
        const m = ensureMem0State(getDb());
        const body = req.body || {};
        if (body.enabled != null) m.enabled = !!body.enabled && body.enabled !== 'false';
        if (body.baseUrl != null) {
            const b = String(body.baseUrl).trim().slice(0, 300);
            m.baseUrl = b ? b.replace(/\/+$/, '') : MEM0_DEFAULT_BASE;
        }
        if (body.clearKey) m.apiKey = '';
        else if (body.apiKey != null && String(body.apiKey).length > 0) m.apiKey = String(body.apiKey).slice(0, 500);
        saveDB();
        res.json({ ok: true, mem0: { enabled: m.enabled, baseUrl: m.baseUrl, hasKey: !!m.apiKey, keyMask: maskKey(m.apiKey) } });
    });

    router.post('/test', async (req, res) => {
        try {
            const c = client();
            const r = await c.search('проверка подключения', { agent_id: 'mandarin-asst-admin' }, 1);
            res.json({ ok: true, results: Array.isArray(r.results) ? r.results.length : 0 });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) });
        }
    });

    router.get('/memories', async (req, res) => {
        try {
            const id = String((req.query && req.query.id) || '');
            if (!id) { res.status(400).json({ ok: false, error: 'Нужен id ассистента' }); return; }
            const c = client();
            const page = await c.list({ agent_id: agentKey(id) }, 1, 50);
            res.json({
                ok: true,
                count: page.count != null ? page.count : (page.results || []).length,
                memories: (page.results || []).map(m => ({
                    id: m.id,
                    memory: m.memory,
                    categories: m.categories || [],
                    createdAt: m.created_at || null
                }))
            });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) });
        }
    });

    router.post('/search', async (req, res) => {
        try {
            const body = req.body || {};
            const id = String(body.id || '');
            const query = String(body.query || '').trim();
            if (!id || !query) { res.status(400).json({ ok: false, error: 'Нужны id ассистента и query' }); return; }
            const c = client();
            const r = await c.search(query, { agent_id: agentKey(id) }, Math.min(20, Math.max(1, parseInt(body.topK, 10) || 5)));
            res.json({
                ok: true,
                memories: (r.results || []).map(m => ({ id: m.id, memory: m.memory, score: m.score }))
            });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) });
        }
    });

    router.post('/delete', async (req, res) => {
        try {
            const memoryId = String((req.body && req.body.memoryId) || '').trim();
            if (!memoryId) { res.status(400).json({ ok: false, error: 'Нужен memoryId' }); return; }
            const c = client();
            await c.deleteOne(memoryId);
            res.json({ ok: true });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) });
        }
    });

    router.post('/delete-all', async (req, res) => {
        try {
            const id = String((req.body && req.body.id) || '');
            if (!id) { res.status(400).json({ ok: false, error: 'Нужен id ассистента' }); return; }
            const c = client();
            const page = await c.list({ agent_id: agentKey(id) }, 1, 100);
            const items = page.results || [];
            let deleted = 0;
            for (const m of items) {
                try { await c.deleteOne(m.id); deleted++; } catch (e) { /* пропускаем неудалённые */ }
            }
            res.json({ ok: true, deleted });
        } catch (e) {
            res.status(e && e.status ? e.status : 500).json({ ok: false, error: trimErr(e && e.message) });
        }
    });

    return router;
}

module.exports = { createMem0Client, createMem0Router, agentKey, maskKey, MEM0_DEFAULT_BASE };
