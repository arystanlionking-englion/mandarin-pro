// Smoke-тест Open WebUI-клиента: chat/completions (Bearer, system+mem0), список моделей, опциональный ключ.
const express = require('express');
const http = require('http');
const { createOpenWebUIRouter } = require('./openwebui-client.js');
const { createAssistantsRouter } = require('./assistants-api.js');

let passed = 0, failed = 0;
function ok(cond, name, extra) {
    if (cond) { passed++; console.log('  OK  ' + name); }
    else { failed++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

const OWUI_KEY = 'sk-owui0123456789abcdef0123456789ab';
const calls = [];

function mockFetch(url, opts) {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const headers = (opts && opts.headers) || {};
    calls.push({ url: u, method, body, headers });

    if (u.endsWith('/models') || u.includes('/models?')) {
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                object: 'list',
                data: [
                    { id: 'llama3:8b', name: 'Llama 3 8B' },
                    { id: 'gpt-4o-mini', name: 'GPT-4o mini' }
                ]
            }))
        });
    }
    if (u.includes('/chat/completions')) {
        if (u.includes('broken')) {
            return Promise.resolve({ ok: false, status: 502, text: () => Promise.resolve(JSON.stringify({ error: { message: 'upstream down, key=' + OWUI_KEY } })) });
        }
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: 'ответ owui: ' + ((body && body.messages && body.messages[body.messages.length - 1] && body.messages[body.messages.length - 1].content) || '') } }]
            }))
        });
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('{}') });
}

const db = {};
const mem0Stub = {
    isEnabled: () => true,
    search: () => Promise.resolve({ results: [{ memory: 'Админ любит чай' }] }),
    add: () => Promise.resolve({})
};

const app = express();
app.use(express.json());
app.use('/api/openwebui', createOpenWebUIRouter({ validateToken: t => t === 'adm1', getDb: () => db, fetchImpl: mockFetch }));
app.use('/api/assistants', createAssistantsRouter({ validateToken: t => t === 'adm1', getDb: () => db, saveDB: () => { }, fetchImpl: mockFetch, mem0: mem0Stub }));

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
    console.log('— Open WebUI: smoke-тест —');

    // 1. Auth
    let r = await j('GET', '/api/openwebui/models?id=admin');
    ok(r.status === 403, 'GET /api/openwebui/models без токена → 403', r.status);

    // 2. Config: провайдер openwebui, ключ маскируется
    r = await j('POST', '/api/assistants/config', {
        id: 'admin', provider: 'openwebui', baseUrl: 'http://127.0.0.1:8080/api',
        apiKey: OWUI_KEY, model: 'llama3:8b', system: 'Ты помощник.', memory: true
    }, 'adm1');
    ok(r.status === 200 && r.data.assistant.provider === 'openwebui', 'config: провайдер openwebui принят', r.status);
    ok(r.data.assistant.hasKey === true && !JSON.stringify(r.data).includes(OWUI_KEY), 'ключ замаскирован', r.data.assistant.keyMask);

    // 3. Чат: POST /chat/completions с Bearer, system + mem0 в system
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'admin', message: 'привет' }, 'adm1');
    ok(r.status === 200 && /ответ owui/.test(r.data.reply), 'chat openwebui → ответ', JSON.stringify(r.data));
    const ch = calls.find(c => c.url.includes('/chat/completions'));
    ok(!!ch && ch.url === 'http://127.0.0.1:8080/api/chat/completions', 'вызван /api/chat/completions', calls.map(c => c.url).join(','));
    ok(ch && ch.headers['Authorization'] === 'Bearer ' + OWUI_KEY, 'заголовок Bearer');
    ok(ch && ch.body.model === 'llama3:8b', 'модель из настроек', ch && ch.body.model);
    ok(ch && ch.body.messages[0].role === 'system' && /Ты помощник\./.test(ch.body.messages[0].content) && /Админ любит чай/.test(ch.body.messages[0].content), 'system + факты mem0 в messages[0]', JSON.stringify(ch && ch.body.messages[0]).slice(0, 160));
    ok(ch && ch.body.messages[ch.body.messages.length - 1].content === 'привет', 'последнее сообщение = запрос');

    // 4. mem0: обмен пишется (add вызван через mem0-stub — проверяем, что search отработал до chat)
    ok(calls.filter(c => c.url.includes('/chat/completions')).length === 1, 'ровно один вызов модели');

    // 5. Без ключа (инстанс без авторизации) — Bearer не отправляется
    await j('POST', '/api/assistants/config', { id: 'method', provider: 'openwebui', baseUrl: 'http://127.0.0.1:8080/api', model: 'llama3:8b', memory: false }, 'adm1');
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'method', message: 'без ключа' }, 'adm1');
    const noKey = calls.find(c => c.url.includes('/chat/completions'));
    ok(r.status === 200 && noKey && !noKey.headers['Authorization'], 'без ключа: Authorization не отправляется', r.status);

    // 6. Без модели → понятная 400
    await j('POST', '/api/assistants/config', { id: 'writer', provider: 'openwebui', baseUrl: 'http://127.0.0.1:8080/api', model: '' }, 'adm1');
    r = await j('POST', '/api/assistants/chat', { id: 'writer', message: 'x' }, 'adm1');
    ok(r.status === 400 && /модель/i.test(r.data.error || ''), 'без модели → 400', JSON.stringify(r.data));

    // 7. Ошибка провайдера: ключ не утекает
    await j('POST', '/api/assistants/config', { id: 'writer', provider: 'openwebui', baseUrl: 'http://broken-host:9/api', model: 'x', apiKey: OWUI_KEY }, 'adm1');
    r = await j('POST', '/api/assistants/chat', { id: 'writer', message: 'x' }, 'adm1');
    ok(r.status >= 400 && !JSON.stringify(r.data).includes(OWUI_KEY), 'ошибка без ключа в тексте', JSON.stringify(r.data));

    // 8. Список моделей: подключение из настроек ассистента
    calls.length = 0;
    r = await j('GET', '/api/openwebui/models?id=admin', null, 'adm1');
    ok(r.status === 200 && r.data.models.length === 2 && r.data.models[0].id === 'llama3:8b' && r.data.models[0].name === 'Llama 3 8B', 'GET /models: id+name', JSON.stringify(r.data.models));
    const ml = calls.find(c => c.url.includes('/models'));
    ok(ml && ml.headers['Authorization'] === 'Bearer ' + OWUI_KEY, 'models: ключ из настроек ассистента', ml && ml.headers['Authorization']);

    // 9. Неизвестный ассистент → 404
    r = await j('GET', '/api/openwebui/models?id=hacker', null, 'adm1');
    ok(r.status === 404, 'models с чужим id → 404', r.status);

    // 10. state не содержит полного ключа
    r = await j('GET', '/api/assistants/state', null, 'adm1');
    ok(!JSON.stringify(r.data).includes(OWUI_KEY) && JSON.stringify(r.data).includes('••••'), 'state: только маска ключа');

    // 11. Провайдер openai продолжает работать (регресс ветки)
    await j('POST', '/api/assistants/config', { id: 'finance', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-oai-1', memory: false }, 'adm1');
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'finance', message: 'тест' }, 'adm1');
    const oa = calls.find(c => c.url === 'https://api.openai.com/v1/chat/completions');
    ok(r.status === 200 && oa && oa.headers['Authorization'] === 'Bearer sk-oai-1', 'openai-ветка без регресса', r.status);

    server.close();
    console.log('\nИтог: ' + passed + ' OK, ' + failed + ' FAIL');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
