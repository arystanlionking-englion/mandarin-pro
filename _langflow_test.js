// Smoke-тест Langflow-клиента: запуск флоу (x-api-key, session_id), список флоу, извлечение текста, интеграция с чатом.
const express = require('express');
const http = require('http');
const { createLangflowRouter, extractLangflowText } = require('./langflow-client.js');
const { createAssistantsRouter } = require('./assistants-api.js');

let passed = 0, failed = 0;
function ok(cond, name, extra) {
    if (cond) { passed++; console.log('  OK  ' + name); }
    else { failed++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

const LF_KEY = 'sk-langflow-secret-abcdef123456';
const calls = [];

function mockFetch(url, opts) {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const headers = (opts && opts.headers) || {};
    calls.push({ url: u, method, body, headers });

    if (u.includes('/api/v1/run/')) {
        if (u.includes('broken-flow')) {
            return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve(JSON.stringify({ detail: 'flow crashed with key ' + LF_KEY })) });
        }
        if (u.includes('variant-flow')) {
            return Promise.resolve({
                ok: true, status: 200,
                text: () => Promise.resolve(JSON.stringify({
                    session_id: 's1',
                    outputs: [{ outputs: [{ results: { message: { data: { text: 'текст из data.text' } } } }] }]
                }))
            });
        }
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                session_id: 's1',
                outputs: [{
                    inputs: { input_value: body ? body.input_value : '' },
                    outputs: [{ results: { message: { text: 'ответ флоу: ' + (body ? body.input_value : '') } } }]
                }]
            }))
        });
    }
    if (u.includes('/api/v1/flows/')) {
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({
                flows: [{ id: 'flow-111', name: 'Помощник школы' }, { id: 'flow-222', name: 'Тесты HSK' }]
            }))
        });
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('{}') });
}

const db = {};
// мок mem0: факты всегда доступны, add ничего не делает
const mem0Stub = {
    isEnabled: () => true,
    search: () => Promise.resolve({ results: [{ memory: 'Админ любит чай' }] }),
    add: () => Promise.resolve({})
};

const app = express();
app.use(express.json());
app.use('/api/langflow', createLangflowRouter({ validateToken: t => t === 'adm1', getDb: () => db, fetchImpl: mockFetch }));
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
    console.log('— Langflow: smoke-тест —');

    // 0. Извлечение текста из разных форматов
    ok(extractLangflowText({ outputs: [{ outputs: [{ results: { message: { text: 'A' } } }] }] }) === 'A', 'extract: results.message.text');
    ok(extractLangflowText({ outputs: [{ outputs: [{ results: { message: { data: { text: 'B' } } } }] }] }) === 'B', 'extract: results.message.data.text');
    ok(extractLangflowText({ outputs: [{ outputs: [{ artifacts: { message: { text: 'C' } } }] }] }) === 'C', 'extract: artifacts.message.text');
    ok(extractLangflowText({ outputs: [{ outputs: [{ message: { text: 'D' } }] }] }) === 'D', 'extract: outputs[].message.text');

    // 1. Auth
    let r = await j('GET', '/api/langflow/flows?id=admin');
    ok(r.status === 403, 'GET /api/langflow/flows без токена → 403', r.status);

    // 2. Настройка ассистента: langflow + флоу + ключ
    r = await j('POST', '/api/assistants/config', {
        id: 'admin', provider: 'langflow', baseUrl: 'http://127.0.0.1:7860', apiKey: LF_KEY,
        model: 'flow-abc', system: 'Системный', memory: true
    }, 'adm1');
    ok(r.status === 200 && r.data.assistant.provider === 'langflow', 'config: провайдер langflow принят', r.status);
    ok(r.data.assistant.hasKey === true && !JSON.stringify(r.data).includes(LF_KEY), 'ключ замаскирован', r.data.assistant.keyMask);

    // 3. Чат: POST /api/v1/run/{flow} с x-api-key и session_id
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'admin', message: 'привет' }, 'adm1');
    ok(r.status === 200 && /ответ флоу/.test(r.data.reply), 'chat langflow → ответ флоу', JSON.stringify(r.data));
    const run = calls.find(c => c.url.includes('/api/v1/run/flow-abc'));
    ok(!!run && run.method === 'POST', 'вызван POST /api/v1/run/flow-abc', calls.map(c => c.url).join(','));
    ok(run && run.headers['x-api-key'] === LF_KEY, 'заголовок x-api-key');
    ok(run && run.body.input_type === 'chat' && run.body.output_type === 'chat', 'input_type/output_type = chat', JSON.stringify(run && run.body));
    ok(run && run.body.session_id === 'mandarin-asst-admin', 'session_id = mandarin-asst-admin', run && run.body.session_id);

    // 4. Контекст mem0 уходит в input_value (а не в system)
    ok(run && /Факты из памяти/.test(run.body.input_value) && /Админ любит чай/.test(run.body.input_value) && /привет/.test(run.body.input_value), 'факты mem0 в input_value', JSON.stringify(run && run.body.input_value).slice(0, 160));

    // 5. Второй чат — тот же session_id (непрерывность диалога в Langflow)
    await j('POST', '/api/assistants/chat', { id: 'admin', message: 'ещё' }, 'adm1');
    const runs = calls.filter(c => c.url.includes('/api/v1/run/flow-abc'));
    ok(runs.length === 2 && runs[1].body.session_id === 'mandarin-asst-admin', 'session_id стабилен между чатами', runs.map(x => x.body.session_id).join(','));

    // 6. Вариант ответа data.text
    await j('POST', '/api/assistants/config', { id: 'method', provider: 'langflow', baseUrl: 'http://127.0.0.1:7860', model: 'variant-flow', memory: false }, 'adm1');
    r = await j('POST', '/api/assistants/chat', { id: 'method', message: 'тест' }, 'adm1');
    ok(r.status === 200 && r.data.reply === 'текст из data.text', 'chat: вариант data.text', JSON.stringify(r.data));

    // 7. Без ключа (локальный Langflow без авторизации) — запрос уходит без x-api-key
    calls.length = 0;
    r = await j('POST', '/api/assistants/chat', { id: 'method', message: 'без ключа' }, 'adm1');
    const noKeyRun = calls.find(c => c.url.includes('/api/v1/run/'));
    ok(r.status === 200 && noKeyRun && !noKeyRun.headers['x-api-key'], 'без ключа: x-api-key не отправляется', r.status);

    // 8. Не задан ID флоу → понятная 400
    await j('POST', '/api/assistants/config', { id: 'writer', provider: 'langflow', baseUrl: 'http://127.0.0.1:7860', model: '' }, 'adm1');
    r = await j('POST', '/api/assistants/chat', { id: 'writer', message: 'x' }, 'adm1');
    ok(r.status === 400 && /флоу/i.test(r.data.error || ''), 'без ID флоу → 400', JSON.stringify(r.data));

    // 9. Ошибка провайдера: ключ не утекает
    await j('POST', '/api/assistants/config', { id: 'writer', provider: 'langflow', baseUrl: 'http://127.0.0.1:7860', model: 'broken-flow', apiKey: LF_KEY }, 'adm1');
    r = await j('POST', '/api/assistants/chat', { id: 'writer', message: 'x' }, 'adm1');
    ok(r.status >= 400 && !JSON.stringify(r.data).includes(LF_KEY), 'ошибка langflow без ключа в тексте', JSON.stringify(r.data));

    // 10. Список флоу: берёт подключение из настроек ассистента
    calls.length = 0;
    r = await j('GET', '/api/langflow/flows?id=admin', null, 'adm1');
    ok(r.status === 200 && r.data.flows.length === 2 && r.data.flows[0].id === 'flow-111' && r.data.flows[0].name === 'Помощник школы', 'GET /flows: id+name', JSON.stringify(r.data.flows));
    const lf = calls.find(c => c.url.includes('/api/v1/flows/'));
    ok(lf && lf.headers['x-api-key'] === LF_KEY, 'flows: ключ из настроек ассистента', lf && lf.headers['x-api-key']);

    // 11. Неизвестный ассистент → 404
    r = await j('GET', '/api/langflow/flows?id=hacker', null, 'adm1');
    ok(r.status === 404, 'flows с чужим id → 404', r.status);

    // 12. Настройки-ответ не содержит ключа целиком
    r = await j('GET', '/api/assistants/state', null, 'adm1');
    ok(!JSON.stringify(r.data).includes(LF_KEY) && JSON.stringify(r.data).includes('••••'), 'state: только маска ключа');

    server.close();
    console.log('\nИтог: ' + passed + ' OK, ' + failed + ' FAIL');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
