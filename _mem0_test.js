// Smoke-тест mem0-клиента: формы запросов (Token-auth, agent_id), маски ключа, интеграция с чатом ассистентов.
const express = require('express');
const http = require('http');
const { createMem0Client, createMem0Router } = require('./mem0-client.js');
const { createAssistantsRouter } = require('./assistants-api.js');

let passed = 0, failed = 0;
function ok(cond, name, extra) {
    if (cond) { passed++; console.log('  OK  ' + name); }
    else { failed++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

const MEM_KEY = 'mem0-secret-key-1234567890';
const calls = [];
let mem0Down = false;

function mockFetch(url, opts) {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const headers = (opts && opts.headers) || {};
    calls.push({ url: u, method, body, headers });

    if (u.includes('/v3/memories/add/')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ event_id: 'evt-1', status: 'PENDING' })) });
    }
    if (u.includes('/v3/memories/search/')) {
        if (mem0Down) return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve(JSON.stringify({ error: 'mem0 down ' + MEM_KEY })) });
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                results: [{ id: 'm1', memory: 'Админ любит чай', score: 0.9 }, { id: 'm2', memory: 'Группа HSK-4 учится по вторникам', score: 0.7 }]
            }))
        });
    }
    if (u.includes('/v3/memories/')) {
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                count: 2,
                results: [
                    { id: 'm1', memory: 'Админ любит чай', created_at: '2026-01-01T00:00:00Z' },
                    { id: 'm2', memory: 'Группа HSK-4 учится по вторникам', created_at: '2026-01-02T00:00:00Z' }
                ]
            }))
        });
    }
    if (u.includes('/v1/memories/')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ message: 'Memory deleted successfully!' })) });
    }
    if (u.includes('/chat/completions')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: 'готово' } }] })) });
    }
    if (u.includes('/chat-messages')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ answer: 'готово-dify', conversation_id: 'c9' })) });
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('{}') });
}

const db = {};
const mem0Client = createMem0Client({ getCfg: () => (db.aiAssistants && db.aiAssistants.mem0) || {}, fetchImpl: mockFetch });

const app = express();
app.use(express.json());
app.use('/api/mem0', createMem0Router({ validateToken: t => t === 'adm1', getDb: () => db, saveDB: () => { }, fetchImpl: mockFetch }));
app.use('/api/assistants', createAssistantsRouter({ validateToken: t => t === 'adm1', getDb: () => db, saveDB: () => { }, fetchImpl: mockFetch, mem0: mem0Client }));

const server = http.createServer(app);

function j(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-Admin-Token': token } : {})
        } }, res => {
            let raw = '';
            res.on('data', d => raw += d);
            res.on('end', () => {
                let data = {};
                try { data = JSON.parse(raw); } catch (e) { data = { raw }; }
                resolve({ status: res.status || res.statusCode, data });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    console.log('— mem0: smoke-тест —');

    // 1. Auth
    let r = await j('GET', '/api/mem0/state');
    ok(r.status === 403, 'GET /api/mem0/state без токена → 403', r.status);

    // 2. State по умолчанию
    r = await j('GET', '/api/mem0/state', null, 'adm1');
    ok(r.status === 200 && r.data.mem0.enabled === false && r.data.mem0.hasKey === false, 'state по умолчанию: выключено, без ключа', JSON.stringify(r.data));

    // 3. Config: ключ маскируется и не утекает
    r = await j('POST', '/api/mem0/config', { enabled: true, apiKey: MEM_KEY, baseUrl: 'https://api.mem0.ai/' }, 'adm1');
    ok(r.status === 200 && r.data.mem0.enabled === true && r.data.mem0.hasKey === true, 'config: включено, ключ принят', r.status);
    ok(r.data.mem0.keyMask.includes('••••') && !JSON.stringify(r.data).includes(MEM_KEY), 'полный ключ не уходит клиенту', r.data.mem0.keyMask);
    ok(r.data.mem0.baseUrl === 'https://api.mem0.ai', 'слеш в baseUrl обрезан', r.data.mem0.baseUrl);

    // 4. Test: search с agent_id в filters и Token-auth
    calls.length = 0;
    r = await j('POST', '/api/mem0/test', {}, 'adm1');
    ok(r.status === 200, 'POST /test → 200', r.status);
    const searchCall = calls.find(c => c.url.includes('/v3/memories/search/'));
    ok(!!searchCall && searchCall.headers['Authorization'] === 'Token ' + MEM_KEY, 'mem0 auth: Authorization: Token <key>');
    ok(searchCall && searchCall.body.filters && searchCall.body.filters.agent_id === 'mandarin-asst-admin', 'search: filters.agent_id=mandarin-asst-admin', JSON.stringify(searchCall && searchCall.body));

    // 5. List
    calls.length = 0;
    r = await j('GET', '/api/mem0/memories?id=admin', null, 'adm1');
    ok(r.status === 200 && r.data.memories.length === 2 && r.data.memories[0].memory === 'Админ любит чай', 'GET /memories: список ассистента', JSON.stringify(r.data.memories).slice(0, 120));
    const listCall = calls.find(c => c.url.includes('/v3/memories/'));
    ok(listCall && listCall.body.filters.agent_id === 'mandarin-asst-admin', 'list: filters.agent_id', JSON.stringify(listCall && listCall.body));

    // 6. Search по ассистенту method
    calls.length = 0;
    r = await j('POST', '/api/mem0/search', { id: 'method', query: 'чай', topK: 3 }, 'adm1');
    ok(r.status === 200 && r.data.memories.length === 2, 'POST /search → результаты', r.status);
    ok(calls[0].body.filters.agent_id === 'mandarin-asst-method', 'search: изоляция по method', JSON.stringify(calls[0].body));

    // 7. Delete one
    calls.length = 0;
    r = await j('POST', '/api/mem0/delete', { memoryId: 'm1' }, 'adm1');
    ok(r.status === 200 && calls[0].method === 'DELETE' && calls[0].url.includes('/v1/memories/m1/'), 'POST /delete → DELETE /v1/memories/{id}/', calls[0] && calls[0].url);

    // 8. Delete all
    calls.length = 0;
    r = await j('POST', '/api/mem0/delete-all', { id: 'admin' }, 'adm1');
    const deletes = calls.filter(c => c.method === 'DELETE');
    ok(r.status === 200 && r.data.deleted === 2 && deletes.length === 2, 'POST /delete-all → удалены обе записи', r.data);

    // 9. Чат + mem0: факты уходят в system (openai), обмен пишется в память
    await j('POST', '/api/assistants/config', { id: 'admin', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test-123', system: 'Ты помощник.' }, 'adm1');
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'admin', message: 'что мне нравится?' }, 'adm1');
    ok(r.status === 200 && r.data.reply === 'готово', 'chat с mem0 → 200', JSON.stringify(r.data));
    const oa = calls.find(c => c.url.includes('/chat/completions'));
    ok(oa && /Админ любит чай/.test(oa.body.messages[0].content) && /Ты помощник\./.test(oa.body.messages[0].content), 'факты mem0 дописаны в system-промпт', JSON.stringify(oa && oa.body.messages[0]).slice(0, 200));
    const addCall = calls.find(c => c.url.includes('/v3/memories/add/'));
    ok(!!addCall, 'add в mem0 вызван после ответа');
    ok(addCall && addCall.body.agent_id === 'mandarin-asst-admin' && addCall.body.user_id === 'mandarin-admin', 'add: agent_id/user_id', JSON.stringify(addCall && addCall.body).slice(0, 160));
    ok(addCall && addCall.body.messages.length === 2 && addCall.body.messages[0].role === 'user' && addCall.body.messages[1].role === 'assistant', 'add: пары user+assistant', addCall && addCall.body.messages.length);
    ok(addCall && addCall.body.messages.some(m => m.content === 'что мне нравится?') && addCall.body.messages.some(m => m.content === 'готово'), 'add: содержимое обмена');

    // 10. Dify: факты уходят в query, не в system
    await j('POST', '/api/assistants/config', { id: 'writer', provider: 'dify', baseUrl: 'https://api.dify.ai/v1', apiKey: 'app-dify-key' }, 'adm1');
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'writer', message: 'напиши объявление' }, 'adm1');
    ok(r.status === 200 && r.data.reply === 'готово-dify', 'chat dify с mem0 → 200', JSON.stringify(r.data));
    const dy = calls.find(c => c.url.includes('/chat-messages'));
    ok(dy && /Факты из памяти/.test(dy.body.query) && /напиши объявление/.test(dy.body.query), 'dify: контекст памяти в query', JSON.stringify(dy && dy.body.query).slice(0, 200));

    // 11. memory:false → mem0 не трогается
    await j('POST', '/api/assistants/config', { id: 'method', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'x', apiKey: 'sk-2', memory: false }, 'adm1');
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'method', message: 'тест' }, 'adm1');
    ok(r.status === 200 && !calls.some(c => c.url.includes('mem0.ai') || c.url.includes('/v3/memories/') || c.url.includes('/v1/memories/')), 'memory:false → без вызовов mem0', calls.map(c => c.url).join(','));

    // 12. mem0 лежит → чат работает, ключ не утекает в ошибках
    mem0Down = true;
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'admin', message: 'ещё раз' }, 'adm1');
    ok(r.status === 200 && r.data.reply === 'готово', 'сбой mem0 не роняет чат', r.status);
    ok(!JSON.stringify(r.data).includes(MEM_KEY) && !JSON.stringify(calls.filter(c => c.url.includes('/chat/completions'))).includes(MEM_KEY), 'ключ mem0 не виден в трафике ответа');
    const memErr = await j('POST', '/api/mem0/search', { id: 'admin', query: 'x' }, 'adm1');
    ok(memErr.status >= 400 && typeof memErr.data.error === 'string' && !memErr.data.error.includes(MEM_KEY), 'ошибка mem0 без ключа в тексте', JSON.stringify(memErr.data));
    mem0Down = false;

    // 13. Выключенный mem0 не дёргает API
    await j('POST', '/api/mem0/config', { enabled: false }, 'adm1');
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'admin', message: 'выключено' }, 'adm1');
    ok(r.status === 200 && !calls.some(c => c.url.includes('/v3/memories/')), 'mem0 выключен → без поиска/записи', calls.map(c => c.url).join(','));

    server.close();
    console.log('\nИтог: ' + passed + ' OK, ' + failed + ' FAIL');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
