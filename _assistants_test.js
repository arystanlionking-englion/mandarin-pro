// Smoke-тест ИИ-ассистентов: auth, state, config, chat (dify/openai/claude), ошибки без утечки ключей, clear.
const express = require('express');
const http = require('http');
const { createAssistantsRouter } = require('./assistants-api.js');

let passed = 0, failed = 0;
function ok(cond, name, extra) {
    if (cond) { passed++; console.log('  OK  ' + name); }
    else { failed++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

const FAKE_KEY = 'sk-test-secret-1234567890';
const db = {};
const calls = [];

function mockFetch(url, opts) {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null, headers: (opts && opts.headers) || {} });
    const u = String(url);
    if (u.includes('/broken')) {
        return Promise.resolve({
            ok: false, status: 401,
            text: () => Promise.resolve(JSON.stringify({ error: { message: 'bad key ' + FAKE_KEY } }))
        });
    }
    if (u.includes('/chat-messages')) {
        const body = JSON.parse(opts.body);
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                answer: 'ok-dify:' + body.query,
                conversation_id: 'conv-42'
            }))
        });
    }
    if (u.includes('/chat/completions')) {
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: 'ok-openai' } }]
            }))
        });
    }
    if (u.includes('/v1/messages')) {
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                content: [{ type: 'text', text: 'ok-claude' }]
            }))
        });
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('{}') });
}

const app = express();
app.use(express.json());
app.use('/api/assistants', createAssistantsRouter({
    validateToken: t => t === 'adm1',
    getDb: () => db,
    saveDB: () => { },
    fetchImpl: mockFetch
}));

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
    console.log('— ИИ-ассистенты: smoke-тест —');

    // 1. Без токена — 403
    let r = await j('GET', '/api/assistants/state');
    ok(r.status === 403, 'GET /state без токена → 403', r.status);

    // 2. Неверный токен — 403
    r = await j('GET', '/api/assistants/state', null, 'wrong');
    ok(r.status === 403, 'GET /state с чужим токеном → 403', r.status);

    // 3. State с токеном: 4 ассистента
    r = await j('GET', '/api/assistants/state', null, 'adm1');
    ok(r.status === 200 && r.data.ok === true, 'GET /state → ok', r.status);
    ok(Array.isArray(r.data.assistants) && r.data.assistants.length === 4, 'в state 4 ассистента', JSON.stringify(r.data.assistants && r.data.assistants.length));
    ok(r.data.assistants.every(a => a.hasKey === false && !a.keyMask), 'ключи по умолчанию не заданы');
    ok(r.data.assistants.every(a => a.provider === 'dify'), 'провайдер по умолчанию dify');

    // 4. Сохранение конфига с ключом — ключ маскируется
    r = await j('POST', '/api/assistants/config', { id: 'admin', provider: 'dify', baseUrl: 'https://api.dify.ai/v1', apiKey: FAKE_KEY, name: 'Помощник' }, 'adm1');
    ok(r.status === 200 && r.data.ok === true, 'POST /config → ok', r.status);
    ok(r.data.assistant.hasKey === true && r.data.assistant.keyMask.includes('••••'), 'ключ замаскирован', JSON.stringify(r.data.assistant.keyMask));
    ok(!JSON.stringify(r.data).includes(FAKE_KEY), 'полный ключ не уходит клиенту');

    // 5. Chat через dify
    r = await j('POST', '/api/assistants/chat', { id: 'admin', message: 'привет' }, 'adm1');
    ok(r.status === 200 && r.data.reply === 'ok-dify:привет', 'chat dify → ответ', JSON.stringify(r.data));
    ok(r.data.convId === 'conv-42', 'conversation_id сохранён', r.data.convId);

    // 6. Повторный chat: conversation_id переиспользуется
    await j('POST', '/api/assistants/chat', { id: 'admin', message: 'ещё раз' }, 'adm1');
    const difyCalls = calls.filter(c => c.url.includes('/chat-messages'));
    ok(difyCalls.length === 2 && difyCalls[1].body.conversation_id === 'conv-42', 'conversation_id переиспользуется', JSON.stringify(difyCalls.map(c => c.body.conversation_id)));

    // 7. История изолирована: у method пусто
    r = await j('GET', '/api/assistants/state', null, 'adm1');
    ok((r.data.chats.admin || []).length === 4, 'история admin: 4 сообщения', (r.data.chats.admin || []).length);
    ok((r.data.chats.method || []).length === 0, 'история method пуста (изоляция ассистентов)');

    // 8. OpenAI-совместимый (LiteLLM)
    r = await j('POST', '/api/assistants/config', { id: 'method', provider: 'openai', baseUrl: 'http://127.0.0.1:4000/v1', model: 'gpt-4o-mini', apiKey: FAKE_KEY, system: 'Системный промпт' }, 'adm1');
    ok(r.status === 200, 'config method → openai', r.status);
    r = await j('POST', '/api/assistants/chat', { id: 'method', message: 'сделай тест' }, 'adm1');
    ok(r.status === 200 && r.data.reply === 'ok-openai', 'chat openai → ответ', JSON.stringify(r.data));
    const oaCall = calls.filter(c => c.url.includes('/chat/completions')).pop();
    ok(oaCall && oaCall.body.model === 'gpt-4o-mini', 'openai: model передан', oaCall && oaCall.body.model);
    ok(oaCall && oaCall.body.messages[0].role === 'system' && oaCall.body.messages[0].content === 'Системный промпт', 'openai: system в messages[0]');
    ok(oaCall && oaCall.body.messages[oaCall.body.messages.length - 1].content === 'сделай тест', 'openai: последнее сообщение = запрос');

    // 9. Claude (Anthropic Messages)
    await j('POST', '/api/assistants/config', { id: 'finance', provider: 'claude', baseUrl: 'https://api.anthropic.com/', model: 'claude-sonnet-4-5', apiKey: FAKE_KEY }, 'adm1');
    r = await j('POST', '/api/assistants/chat', { id: 'finance', message: 'посчитай' }, 'adm1');
    ok(r.status === 200 && r.data.reply === 'ok-claude', 'chat claude → ответ', JSON.stringify(r.data));
    const clCall = calls.filter(c => c.url.includes('/v1/messages')).pop();
    ok(clCall && clCall.url === 'https://api.anthropic.com/v1/messages', 'claude: URL нормализован', clCall && clCall.url);
    ok(clCall && clCall.headers['x-api-key'] === FAKE_KEY && clCall.headers['anthropic-version'], 'claude: заголовки авторизации');

    // 10. Ошибка провайдера: ключ не утекает в текст ошибки
    r = await j('POST', '/api/assistants/config', { id: 'writer', provider: 'dify', baseUrl: 'https://api.dify.ai/v1/broken', apiKey: FAKE_KEY }, 'adm1');
    r = await j('POST', '/api/assistants/chat', { id: 'writer', message: 'тест ошибки' }, 'adm1');
    ok(r.status === 401 || r.status === 502, 'chat с ошибкой провайдера → 4xx/5xx', r.status);
    ok(typeof r.data.error === 'string' && !r.data.error.includes(FAKE_KEY), 'текст ошибки без ключа', JSON.stringify(r.data.error));

    // 11. Пустой ключ — понятная ошибка
    await j('POST', '/api/assistants/config', { id: 'writer', provider: 'dify', clearKey: true }, 'adm1');
    r = await j('POST', '/api/assistants/chat', { id: 'writer', message: 'привет' }, 'adm1');
    ok(r.status === 400 && /ключ/i.test(r.data.error || ''), 'chat без ключа → 400 про ключе', JSON.stringify(r.data));

    // 12. Test + clear
    r = await j('POST', '/api/assistants/test', { id: 'admin' }, 'adm1');
    ok(r.status === 200 && r.data.reply, 'POST /test → ok', JSON.stringify(r.data));
    r = await j('POST', '/api/assistants/clear', { id: 'admin' }, 'adm1');
    ok(r.status === 200, 'POST /clear → ok', r.status);
    r = await j('GET', '/api/assistants/state', null, 'adm1');
    ok((r.data.chats.admin || []).length === 0, 'после clear история пуста');

    // 13. Неизвестный id — 404
    r = await j('POST', '/api/assistants/chat', { id: 'hacker', message: 'x' }, 'adm1');
    ok(r.status === 404, 'chat с чужим id → 404', r.status);

    server.close();
    console.log('\nИтог: ' + passed + ' OK, ' + failed + ' FAIL');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
