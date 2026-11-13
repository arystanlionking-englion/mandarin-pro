/* Браузерный smoke ИИ-ассистентов: headless Chrome + CDP, scratch-БД, реальный админ-токен. */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = __dirname;
const PORT = 3212;
const CDP_PORT = 9344;
const BASE = 'http://127.0.0.1:' + PORT;
const APP = BASE + '/index.html';
const DB_PATH = path.join(ROOT, 'database.json');
const BAK_PATH = path.join(ROOT, 'database.json.asstui.bak');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; console.log('PASS — ' + name); }
    else { failed++; console.log('FAIL — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

function cdpEval(ws, expression, awaitPromise) {
    const id = Math.floor(Math.random() * 1e9);
    return new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('cdp timeout: ' + expression.slice(0, 80))), 20000);
        function onMsg(raw) {
            const m = JSON.parse(raw);
            if (m.id !== id) return;
            clearTimeout(to);
            ws.off('message', onMsg);
            if (m.error) reject(new Error(JSON.stringify(m.error)));
            else resolve(m.result);
        }
        ws.on('message', onMsg);
        ws.send(JSON.stringify({
            id, method: 'Runtime.evaluate',
            params: { expression, awaitPromise: !!awaitPromise, returnByValue: true, userGesture: true }
        }));
    });
}

function adminLogin(pin) {
    return new Promise((resolve, reject) => {
        const s = io(BASE, { transports: ['websocket'], reconnection: false });
        const to = setTimeout(() => { s.close(); reject(new Error('admin login timeout')); }, 8000);
        s.on('connect_error', e => { clearTimeout(to); reject(e); });
        s.on('admin:authenticated', d => { clearTimeout(to); resolve({ socket: s, token: d.adminToken }); });
        s.on('connect', () => s.emit('admin:login', { pin }));
    });
}

(async () => {
    const hadDb = fs.existsSync(DB_PATH);
    if (hadDb) fs.renameSync(DB_PATH, BAK_PATH);
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }), 'utf8');
    let child = null, chrome = null;
    try {
        child = spawn(process.execPath, ['server.js'], {
            cwd: ROOT,
            env: Object.assign({}, process.env, { PORT: String(PORT) }),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        for (let i = 0; i < 60; i++) {
            if (child.exitCode !== null) throw new Error('сервер завершился при старте');
            try { const r = await fetch(BASE + '/'); if (r.status < 500) break; } catch (e) { }
            await sleep(500);
        }
        const admin = await adminLogin('1234');
        if (!admin.token) throw new Error('нет админ-токена');

        const userDataDir = path.join(__dirname, '.chrome_asst_ui');
        chrome = spawn(CHROME, [
            '--headless=new', '--disable-gpu', '--no-sandbox',
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + userDataDir,
            '--window-size=1280,900', 'about:blank'
        ], { stdio: 'ignore' });

        let list = null;
        for (let i = 0; i < 40; i++) {
            try { list = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list'); if (list && list.length) break; } catch (e) { }
            await sleep(250);
        }
        if (!list || !list.length) throw new Error('Chrome CDP недоступен');
        const page = list.find(t => t.type === 'page') || list[0];
        const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
        await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
        ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
        ws.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: APP } }));
        await sleep(4000);

        console.log('— ИИ-ассистенты: браузерный smoke —');

        // Кнопка есть в админ-панели (оба места)
        const btns = await cdpEval(ws, `document.querySelectorAll('button[onclick="openAssistants()"]').length`);
        ok('кнопка «4 ассистента» в админ-панели', btns.result && btns.result.value >= 2, btns.result && btns.result.value);

        // index.html при 127.0.0.1 подключает socket.io к :3000 — направляем на наш порт и чистим старые токены
        await cdpEval(ws, `(function(){
            localStorage.setItem('pb_server_url', location.origin);
            localStorage.removeItem('pb_admin_token');
            localStorage.removeItem('pb_session_token');
            localStorage.removeItem('pb_cache_user');
        })()`);
        ws.send(JSON.stringify({ id: 8, method: 'Page.reload' }));
        await sleep(4500);

        // Админ-контекст: настоящий вход через UI-модалку с PIN (как у живого администратора)
        let v = {};
        for (let i = 0; i < 12; i++) {
            const open = await cdpEval(ws, `(async () => {
                if (window._isMainAdmin !== true) {
                    try { window.showAdminLogin(); } catch (e) {}
                    await new Promise(r => setTimeout(r, 350));
                    const wrap = document.getElementById('adminModalPinFields');
                    const fields = wrap ? [...wrap.querySelectorAll('.pin-field')] : [];
                    fields.forEach((f, idx) => {
                        f.value = '1234'[idx] || '';
                        f.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                    if (fields.length && typeof window.doAdminLoginModal === 'function') window.doAdminLoginModal();
                    await new Promise(r => setTimeout(r, 1200));
                }
                if (window._isMainAdmin === true) window.openAssistants();
                await new Promise(r => setTimeout(r, 500));
                const tabs = [...document.querySelectorAll('#asstTabs .asst-tab')];
                return {
                    isAdmin: window._isMainAdmin === true,
                    overlayOn: document.getElementById('asstOverlay').classList.contains('on'),
                    tabCount: tabs.length,
                    tabText: document.getElementById('asstTabs').textContent.replace(/\\s+/g, ' ').trim(),
                    emptyState: !!document.querySelector('#asstMsgs .asst-empty'),
                    status: (document.getElementById('asstStatus') || {}).textContent || ''
                };
            })()`, true);
            v = (open.result && open.result.value) || {};
            if (v.overlayOn) break;
            await sleep(700);
        }
        if (!v.overlayOn) {
            const diag = await cdpEval(ws, `({
                isMain: window._isMainAdmin === true,
                hasToken: !!localStorage.getItem('pb_admin_token'),
                pinFields: (document.getElementById('adminModalPinFields') || { querySelectorAll: () => [] }).querySelectorAll('.pin-field').length,
                modalVisible: (function(){ var m = document.getElementById('mAdminLogin'); return m ? !m.classList.contains('hidden') && m.style.display !== 'none' : null; })(),
                toastText: (function(){ var els = document.querySelectorAll('#toast,.toast,div[class*=toast]'); return [...els].map(e => e.textContent).join(' | ').slice(0, 300); })()
            })`);
            console.log('diag:', JSON.stringify(diag.result && diag.result.value));
        }
        ok('оверлей открылся', v.overlayOn === true, v);
        ok('4 вкладки ассистентов', v.tabCount === 4, v.tabCount);
        ok('имена ассистентов на вкладках', /Помощник администратора/.test(v.tabText) && /Методист/.test(v.tabText) && /Финансовый аналитик/.test(v.tabText) && /Копирайтер/.test(v.tabText), v.tabText);
        ok('пустое состояние диалога', v.emptyState === true, v);

        // Настройки: форма, провайдер, ключ, промпт
        const set = await cdpEval(ws, `(async () => {
            window.toggleAsstSettings();
            await new Promise(r => setTimeout(r, 300));
            return {
                settingsOn: document.getElementById('asstSettings').classList.contains('on'),
                hasProvider: !!document.getElementById('asstCfgProvider'),
                providers: [...(document.getElementById('asstCfgProvider') || { options: [] }).options].map(o => o.value).join(','),
                hasKey: !!document.getElementById('asstCfgKey'),
                hasSystem: !!document.getElementById('asstCfgSystem'),
                hasTest: /Проверить связь/.test(document.getElementById('asstSettings').textContent),
                hasFlowsBtn: /Флоу Langflow/.test(document.getElementById('asstSettings').textContent),
                hasOwuiBtn: /Модели Open WebUI/.test(document.getElementById('asstSettings').textContent)
            };
        })()`, true);
        const s = set.result && set.result.value || {};
        ok('панель настроек открылась', s.settingsOn === true, s);
        ok('выпадающий список провайдеров dify/openai/claude/langflow/openwebui', s.providers === 'dify,openai,claude,langflow,openwebui', s.providers);
        ok('поля ключа и промпта есть', s.hasKey && s.hasSystem && s.hasTest, s);
        ok('кнопка «Флоу Langflow…» есть', s.hasFlowsBtn === true, s);
        ok('кнопка «Модели Open WebUI…» есть', s.hasOwuiBtn === true, s);

        // mem0: поля подключения и список памяти
        const mem0ui = await cdpEval(ws, `(async () => {
            window.asstShowMemories();
            await new Promise(r => setTimeout(r, 900));
            return {
                mem0Fields: !!(document.getElementById('asstMem0Enabled') && document.getElementById('asstMem0Base') && document.getElementById('asstMem0Key')),
                memoryToggle: !!document.getElementById('asstCfgMemory'),
                mem0Buttons: /Показать память/.test(document.getElementById('asstSettings').textContent) && /Очистить память/.test(document.getElementById('asstSettings').textContent),
                box: (document.getElementById('asstMemList') || {}).textContent || ''
            };
        })()`, true);
        const mu = (mem0ui.result && mem0ui.result.value) || {};
        ok('mem0: поля подключения в настройках', mu.mem0Fields === true, mu);
        ok('mem0: тумблер памяти у ассистента', mu.memoryToggle === true, mu);
        ok('mem0: кнопки «Показать/Очистить память»', mu.mem0Buttons === true, mu);
        ok('mem0: список памяти отвечает (список или ошибка)', (mu.box || '').length > 0, mu.box);

        // Переключение вкладки — независимые ассистенты
        const sw = await cdpEval(ws, `(async () => {
            window.asstSelect('writer');
            await new Promise(r => setTimeout(r, 300));
            return {
                title: (document.querySelector('#asstSettings h4') || {}).textContent || '',
                activeTabs: document.querySelectorAll('#asstTabs .asst-tab.on').length
            };
        })()`, true);
        const w = sw.result && sw.result.value || {};
        ok('переключение на «Копирайтер»', /Копирайтер/.test(w.title) && w.activeTabs === 1, w);

        // Сохранение настроек через форму: ключ из формы уходит на сервер, вкладка теряет «нет ключа»
        const save = await cdpEval(ws, `(async () => {
            if (typeof window.toggleAsstSettings === 'function' && !document.getElementById('asstSettings').classList.contains('on')) window.toggleAsstSettings();
            document.getElementById('asstCfgProvider').value = 'dify';
            document.getElementById('asstCfgBaseUrl').value = 'https://api.dify.ai/v1';
            document.getElementById('asstCfgKey').value = 'app-ui-form-key-123';
            const done = await window.asstSaveConfig();
            await new Promise(r => setTimeout(r, 300));
            return {
                done: done === true,
                status: (document.getElementById('asstStatus') || {}).textContent || '',
                tabs: document.getElementById('asstTabs').textContent.replace(/\\s+/g, ' ').trim(),
                keyMaskShown: /сохранён/.test(document.getElementById('asstSettings').textContent)
            };
        })()`, true);
        const sv = save.result && save.result.value || {};
        ok('форма настроек сохраняет конфиг', sv.done === true && /сохранены/i.test(sv.status), sv);
        ok('вкладка «Копирайтер» без метки «нет ключа» (остальные 3 — с ней)', !/Копирайтер\s*·\s*нет ключа/.test(sv.tabs) && (sv.tabs.split('нет ключа').length - 1) === 3, sv.tabs);
        ok('в настройках показана маска ключа', sv.keyMaskShown === true, sv);

        // Отправка без ключа (у method ключ не задан): ошибка уходит в чат, а не в консоль
        const send = await cdpEval(ws, `(async () => {
            window.asstSelect('method');
            await new Promise(r => setTimeout(r, 250));
            document.getElementById('asstInput').value = 'привет';
            window.asstSend();
            await new Promise(r => setTimeout(r, 1500));
            return {
                msgs: document.getElementById('asstMsgs').textContent.replace(/\\s+/g, ' ').trim(),
                status: (document.getElementById('asstStatus') || {}).textContent || '',
                inputCleared: document.getElementById('asstInput').value === ''
            };
        })()`, true);
        const sd = send.result && send.result.value || {};
        ok('сообщение пользователя в чате', /привет/.test(sd.msgs), sd.msgs);
        ok('ошибка «нет ключа» показана в чате', /⚠️/.test(sd.msgs) && /ключ/i.test(sd.msgs) && /Ошибка/i.test(sd.status), JSON.stringify(sd));
        ok('поле ввода очищено', sd.inputCleared === true, sd);

        // Esc закрывает оверлей
        const esc = await cdpEval(ws, `(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(r => setTimeout(r, 250));
            return { closed: !document.getElementById('asstOverlay').classList.contains('on') };
        })()`, true);
        ok('Esc закрывает оверлей', esc.result && esc.result.value && esc.result.value.closed === true, esc.result && esc.result.value);

        console.log('\nИтог: ' + passed + ' OK, ' + failed + ' FAIL');
        ws.close();
    } finally {
        if (chrome) { try { chrome.kill('SIGKILL'); } catch (e) { } }
        if (child && child.exitCode === null) { try { child.kill('SIGKILL'); } catch (e) { } }
        await sleep(400);
        try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch (e) { }
        if (hadDb) { try { fs.renameSync(BAK_PATH, DB_PATH); } catch (e) { } }
    }
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
