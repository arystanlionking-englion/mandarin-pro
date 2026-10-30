require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

// Flexible DATABASE_URL resolution: env aliases, whitespace, quotes
function resolveDatabaseUrl() {
    const keys = [
        'DATABASE_URL',
        'database_url',
        'DB_URL',
        'db_url',
        'POSTGRES_URL',
        'postgres_url',
        'POSTGRESQL_URL',
        'postgresql_url',
        'SUPABASE_DB_URL',
        'SUPABASE_DATABASE_URL',
        'PG_CONNECTION_STRING',
        'PGURI',
        'PG_URI',
        'DB_CONNECTION_STRING',
        'DATABASE_URI'
    ];
    for (const key of keys) {
        let raw = process.env[key];
        if (raw == null) continue;
        raw = String(raw).trim();
        // Strip accidental surrounding quotes (single/double) from dashboard paste
        if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
            raw = raw.slice(1, -1).trim();
        }
        if (!raw) continue;
        // Basic sanity: must look like a postgres connection string
        if (!/^postgres(ql)?:\/\//i.test(raw)) {
            console.warn(`[PG] Ignoring ${key}: value does not look like a postgres URL`);
            continue;
        }
        // Hosted Supabase: force sslmode=no-verify. pg parses connectionString AFTER
        // explicit options, so sslmode=require becomes ssl:true and overrides
        // Pool's ssl:{rejectUnauthorized:false} → "self-signed certificate in chain".
        if (!/localhost|127\.0\.0\.1/i.test(raw)) {
            if (/[?&]sslmode=/i.test(raw)) {
                raw = raw.replace(/([?&])sslmode=[^&]*/i, '$1sslmode=no-verify');
            } else {
                raw += (raw.includes('?') ? '&' : '?') + 'sslmode=no-verify';
            }
        }
        return { url: raw, source: key };
    }
    return null;
}

const resolvedDb = resolveDatabaseUrl();
const DATABASE_URL = resolvedDb ? resolvedDb.url : '';
const usePg = !!DATABASE_URL;
const isRender = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
let pool = null;
if (usePg) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: /localhost|127\.0\.0\.1/i.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 60000,
        max: 10
    });
    pool.on('error', (err) => {
        console.error('[PG POOL ERROR]', err.message, err.stack || '');
    });
    console.log(`[PG] PostgreSQL storage enabled (from env: ${resolvedDb.source})`);
    console.log('[PG] Host hint:', DATABASE_URL.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@').split('?')[0]);
} else {
    console.warn('[PG] DATABASE_URL not set (checked DATABASE_URL, DB_URL, POSTGRES_URL, SUPABASE_DB_URL, PG_URI, …)');
    console.warn('[PG] Falling back to file storage (database.json).');
    if (isRender) {
        console.warn('[PG][WARN] On Render the filesystem is EPHEMERAL — data WILL be lost on sleep/restart without DATABASE_URL/Supabase.');
        console.warn('[PG][WARN] Set DATABASE_URL in Render Dashboard → Environment. Server will still start (no exit).');
    }
}

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- Parent personal link (public, token-only) ---
app.get('/parent-view', (req, res) => {
    res.sendFile(path.join(__dirname, 'parent-view.html'));
});

// --- Встроенный словарь (существующий HTML) ---
app.get('/dictionary', (req, res) => {
    res.sendFile(path.join(__dirname, '12 версия FINALL', 'DLK AI V1 3 хск 2026 словарь кит.html'));
});
// Сопутствующие файлы словаря (hsk4a_data.js, картинки) — относительные пути из /dictionary
app.get('/hsk4a_data.js', (req, res) => {
    res.sendFile(path.join(__dirname, '12 версия FINALL', 'hsk4a_data.js'));
});
app.get('/hsk1_data.js', (req, res) => {
    res.sendFile(path.join(__dirname, '12 версия FINALL', 'hsk1_data.js'));
});
app.get('/dialogue_data.js', (req, res) => {
    res.sendFile(path.join(__dirname, '12 версия FINALL', 'dialogue_data.js'));
});
app.get('/наш логотип фирмы.jpg', (req, res) => {
    res.sendFile(path.join(__dirname, '12 версия FINALL', 'наш логотип фирмы.jpg'));
});

app.get('/api/parent-view/:token', (req, res) => {
    try {
        const payload = parentViewPayload(String(req.params.token || ''));
        if (!payload.ok) {
            res.status(404).json(payload);
            return;
        }
        res.json(payload);
    } catch (err) {
        console.error('[parent-view]', err.message);
        res.status(500).json({ ok: false, error: 'Внутренняя ошибка' });
    }
});

// --- Импорт теста по шаблону HSK (DOCX / текст) ---
const zlib = require('zlib');

function extractDocxXml(buf) {
    // минимальный ZIP-ридер: ищем word/document.xml в локальных заголовках
    let i = 0;
    while (i < buf.length - 30) {
        if (buf.readUInt32LE(i) === 0x04034b50) {
            const method = buf.readUInt16LE(i + 8);
            let compSize = buf.readUInt32LE(i + 18);
            const nameLen = buf.readUInt16LE(i + 26);
            const extraLen = buf.readUInt16LE(i + 28);
            const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
            const dataStart = i + 30 + nameLen + extraLen;
            if (name === 'word/document.xml') {
                if (!compSize) {
                    // размер в дескрипторе — ищем следующую сигнатуру PK
                    let j = dataStart;
                    while (j < buf.length - 4) {
                        if (buf.readUInt32LE(j) === 0x04034b50 || buf.readUInt32LE(j) === 0x02014b50 || buf.readUInt32LE(j) === 0x06054b50) break;
                        j++;
                    }
                    compSize = j - dataStart;
                }
                const data = buf.slice(dataStart, dataStart + compSize);
                return method === 0 ? data.toString('utf8') : zlib.inflateRawSync(data).toString('utf8');
            }
            i = dataStart + (compSize || 0);
            if (i <= dataStart) i = dataStart + 1;
        } else {
            i++;
        }
    }
    throw new Error('word/document.xml не найден — это не DOCX');
}

function docxXmlToText(xml) {
    return String(xml || '')
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function parseTemplateText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const questions = [];
    const errors = [];
    let title = '';
    let cur = null;

    const flush = () => {
        if (!cur) return;
        const opts = cur.options.map(o => String(o || '').trim());
        const filled = opts.filter(Boolean);
        if (!String(cur.text || '').trim()) {
            errors.push('Строка ' + cur.line + ': нет текста вопроса.');
            cur = null;
            return;
        }
        if (filled.length < 2) {
            errors.push('Вопрос ' + cur.num + ': нужно минимум 2 варианта ответа.');
            cur = null;
            return;
        }
        if (!cur.answer) {
            errors.push('Вопрос ' + cur.num + ': нет строки «Правильный ответ».');
            cur = null;
            return;
        }
        // нормализуем ответ: буква → вариант, текст → буква
        let answer = cur.answer;
        const mLetter = answer.match(/^([A-Da-d])[.)]?\s*(.*)$/);
        if (mLetter) {
            const L = mLetter[1].toUpperCase();
            const idx = L.charCodeAt(0) - 65;
            if (opts[idx]) {
                answer = L;
            } else if (mLetter[2] && opts.indexOf(mLetter[2].trim()) >= 0) {
                answer = L;
            } else if (mLetter[2]) {
                answer = mLetter[2].trim();
            }
        } else {
            const ix = opts.findIndex(o => o.toLowerCase() === answer.toLowerCase());
            if (ix >= 0) answer = 'ABCD'.charAt(ix);
        }
        questions.push({
            id: 'q' + (questions.length + 1) + '_' + Date.now().toString(36),
            text: String(cur.text).trim(),
            options: filled,
            answer,
            points: 1,
            explanation: ''
        });
        cur = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = String(lines[i] || '').replace(/\u00a0/g, ' ').trim();
        if (!raw) continue;

        // заголовок документа
        if (!title && /^HSK/i.test(raw)) { title = raw; continue; }

        // служебные строки шаблона
        if (/^(姓名|日期|班级|得分|Формат|Вопрос варианты|Итого)/.test(raw)) continue;
        if (/^____/.test(raw)) continue;
        if (/^Часть\s+\d+/i.test(raw)) { flush(); continue; }

        // строка ответа
        const am = raw.match(/^Правильный\s+ответ\s*:\s*(.+)$/i);
        if (am && cur) {
            cur.answer = am[1].trim();
            flush();
            continue;
        }

        // вариант ответа: A. / B. / C. / D.
        const om = raw.match(/^([A-Da-d])[.)]\s*(.*)$/);
        if (om && cur && !/^\d/.test(raw)) {
            cur.options[om[1].toUpperCase().charCodeAt(0) - 65] = om[2];
            continue;
        }

        // новый вопрос: "12. текст"
        const qm = raw.match(/^(\d{1,3})\.\s+(.*)$/);
        if (qm) {
            flush();
            cur = { num: qm[1], text: qm[2], options: ['', '', '', ''], answer: '', line: i + 1 };
            continue;
        }

        // продолжение текста вопроса
        if (cur) cur.text += (cur.text ? ' ' : '') + raw;
    }
    flush();
    return { title, questions, errors };
}

app.post('/api/exams/import-template', (req, res) => {
    try {
        const body = req.body || {};
        let text = '';
        if (body.text != null && String(body.text).length) {
            text = String(body.text);
        } else if (body.base64) {
            const buf = Buffer.from(String(body.base64), 'base64');
            const fname = String(body.filename || '').toLowerCase();
            if (fname.endsWith('.docx') || (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50)) {
                text = docxXmlToText(extractDocxXml(buf));
            } else {
                text = buf.toString('utf8');
            }
        } else {
            res.status(400).json({ ok: false, error: 'Нужен файл (base64) или text.' });
            return;
        }
        const parsed = parseTemplateText(text);
        if (!parsed.questions.length) {
            res.json({
                ok: false,
                title: parsed.title,
                questions: [],
                errors: parsed.errors.length ? parsed.errors : ['Не найдено ни одного вопроса. Ожидается формат: «1. вопрос» → «A. …» «B. …» «C. …» «D. …» → «Правильный ответ: B. …»']
            });
            return;
        }
        res.json({ ok: true, title: parsed.title, questions: parsed.questions, errors: parsed.errors });
    } catch (err) {
        console.error('[exams/import-template]', err.message);
        res.status(400).json({ ok: false, error: err.message || 'Не удалось разобрать файл' });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    maxHttpBufferSize: 10 * 1024 * 1024,
    pingInterval: 60000,
    pingTimeout: 3600000
});

const DB_PATH = path.join(__dirname, 'database.json');

// ============ PostgreSQL Storage Layer ============

async function initDB() {
    if (!usePg) return;

    // Hard connection check with retries (handles Render sleep/wake)
    let lastErr = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            await pool.query('SELECT 1');
            console.log('[PG] Connected to PostgreSQL (Supabase)');
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
            console.error(`[PG] Connection attempt ${attempt}/10 failed:`, err.message);
            if (attempt < 10) await new Promise(r => setTimeout(r, Math.min(30000, 2000 * attempt)));
        }
    }
    if (lastErr) throw lastErr;

    // Always ensure the table exists
    await pool.query(`
        CREATE TABLE IF NOT EXISTS app_data (
            key TEXT PRIMARY KEY,
            value JSONB
        )
    `);
    console.log('[PG] ensured table app_data (key TEXT PRIMARY KEY, value JSONB)');

    // Detect old schema (id INT, data JSONB) and migrate if needed
    const { rows: cols } = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'app_data' AND table_schema = 'public'
    `);
    const columnNames = cols.map(r => r.column_name);

    if (columnNames.includes('id') && !columnNames.includes('key')) {
        console.log('[PG] Old schema detected, migrating app_data...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS app_data_new (
                key TEXT PRIMARY KEY,
                value JSONB
            )
        `);
        const { rows } = await pool.query('SELECT data FROM app_data WHERE id = 1');
        if (rows.length > 0 && rows[0].data) {
            await pool.query(
                "INSERT INTO app_data_new (key, value) VALUES ('main', $1)",
                [JSON.stringify(rows[0].data)]
            );
            console.log('[PG] Migrated existing data to new schema');
        }
        await pool.query('DROP TABLE IF EXISTS app_data');
        await pool.query('ALTER TABLE app_data_new RENAME TO app_data');
        console.log('[PG] Migration complete: key/value schema active');
    } else {
        console.log('[PG] Table app_data already has key/value schema');
    }

    console.log('[PG] app_data table ready');
}

// --- PIN Hashing ---

function hashPin(pin, salt) {
    if (!salt) salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
    return { hash, salt };
}

function verifyPin(pin, hash, salt) {
    const result = crypto.scryptSync(String(pin), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(result, 'hex'), Buffer.from(hash, 'hex'));
}

function hashPassword(password, salt) {
    return hashPin(password, salt);
}
function verifyPassword(password, hash, salt) {
    return verifyPin(password, hash, salt);
}

// --- Data Layer ---

const INVESTMENT_TYPES = [
    { id: 'science', name: 'Наука', icon: 'microscope', emoji: '🔬' },
    { id: 'biotech', name: 'Биотехнологии', icon: 'heart-pulse', emoji: '🧬' },
    { id: 'nature', name: 'Природа', icon: 'leaf', emoji: '🌿' },
    { id: 'companies', name: 'Компании', icon: 'building-2', emoji: '🏢' },
    { id: 'certificates', name: 'Сертификаты', icon: 'award', emoji: '🏅' }
];

let db = { users: [], history: [], messages: [], favorites: {}, notifications: [], adminHistory: [], adminPinHash: null, adminSalt: null, groups: [], groupPermissions: {}, investments: [], coupons: [], userCoupons: [], couponNotifications: [], purchaseRequests: [], btcPrice: 47000000, investmentPrices: { science: 10000, biotech: 15000, nature: 8000, companies: 20000, certificates: 12000 }, quests: [], taskAssignments: [], duels: [], userXP: {}, sessions: [], approvalRequests: [], userLists: {}, rests: [], userBlocks: [], qrTerminalHistory: [], battlePass: { seasonEnd: null, userProgress: {} }, promocodes: [], userPromoActivations: [], qrCodes: [], qrAccounts: [], qrCodeScans: [], testResults: [], savingsGoals: [], bankQuests: [], journal: { groups: [], students: [], records: [], settings: { reward: 300 } }, accountRequests: [], securityLog: [], auditLog: [], globalMode: { enabled: false, section: null, updatedAt: null }, party: null, guestMode: { enabled: false }, maintenanceMode: { enabled: false }, guestSessions: [], guestQrTokens: [], guestCounter: 0 };

// True only after loadDB() successfully populated `db` from the real store.
// Prevents empty in-memory defaults from being flushed over real data on startup.
let _dbLoaded = false;

async function loadDB() {
    if (usePg) {
        // Hard read — errors propagate (no silent empty-object fallback)
        const { rows } = await pool.query("SELECT value FROM app_data WHERE key = 'main'");
        if (rows.length > 0 && rows[0].value != null) {
            let parsed = rows[0].value;
            if (typeof parsed === 'string') {
                try {
                    parsed = JSON.parse(parsed);
                } catch (e) {
                    console.error('[PG] FATAL: app_data.value is not valid JSON:', e.message);
                    throw e;
                }
            }
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.users)) {
                console.error('[PG] FATAL: app_data.value is corrupted (users[] missing). Refusing to replace real data with empty defaults.');
                console.error('[PG] value type:', typeof parsed, 'keys:', parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 40) : 'n/a');
                throw new Error('Corrupted app_data: users[] missing — will not start with empty DB');
            }
            _assignDB(parsed);
            _runMigrations();
            _dbLoaded = true;
            console.log('[PG] Database loaded from PostgreSQL, users:', db.users.length);
            return;
        }
        // Table empty — initialize defaults once (first run only)
        console.log('[PG] No data found in app_data, initializing with defaults (first run)');
        _assignDB(null);
        _runMigrations();
        _dbLoaded = true;
        await saveDBImmediate();
        console.log('[PG] Default database written to app_data');
        return;
    }
    // File-based fallback (local only — never on Render)
    try {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.users)) throw new Error('Invalid users array');
        _assignDB(parsed);
        _runMigrations();
        _dbLoaded = true;
    } catch (err) {
        console.error('Failed to load database:', err.message);
        const tmpPath = DB_PATH + '.tmp';
        try {
            if (fs.existsSync(tmpPath)) {
                const tmpRaw = fs.readFileSync(tmpPath, 'utf-8');
                const tmpParsed = JSON.parse(tmpRaw);
                if (Array.isArray(tmpParsed.users)) {
                    console.log('Recovered database from .tmp file');
                    _assignDB(tmpParsed);
                    _runMigrations();
                    _dbLoaded = true;
                    fs.copyFileSync(tmpPath, DB_PATH);
                    return;
                }
            }
        } catch (e2) { console.error('Recovery from .tmp failed:', e2.message); }
        const bakPath = DB_PATH + '.bak';
        try {
            if (fs.existsSync(bakPath)) {
                const bakRaw = fs.readFileSync(bakPath, 'utf-8');
                const bakParsed = JSON.parse(bakRaw);
                if (Array.isArray(bakParsed.users)) {
                    console.log('Recovered database from .bak file');
                    _assignDB(bakParsed);
                    _runMigrations();
                    _dbLoaded = true;
                    fs.copyFileSync(bakPath, DB_PATH);
                    return;
                }
            }
        } catch (e3) { console.error('Recovery from .bak failed:', e3.message); }
        if (fs.existsSync(DB_PATH)) {
            const corruptPath = DB_PATH + '.corrupted.' + Date.now();
            try { fs.copyFileSync(DB_PATH, corruptPath); console.log('Corrupt database saved as:', corruptPath); } catch {}
        }
        _assignDB(null);
        _runMigrations();
        _dbLoaded = true;
        saveDB();
    }
}

function getDefaultDB() {
    return { users: [], history: [], messages: [], favorites: {}, notifications: [], adminHistory: [], adminPinHash: null, adminSalt: null, groups: [], groupPermissions: {}, investments: [], coupons: [], userCoupons: [], couponNotifications: [], purchaseRequests: [], btcPrice: 47000000, investmentPrices: { science: 10000, biotech: 15000, nature: 8000, companies: 20000, certificates: 12000 }, quests: [], taskAssignments: [], duels: [], userXP: {}, sessions: [], approvalRequests: [], userLists: {}, rests: [], userBlocks: [], qrTerminalHistory: [], battlePass: { seasonEnd: null, userProgress: {} }, promocodes: [], userPromoActivations: [], virtualBanks: null, userBankDeposits: [], userBankInvestments: [], bankHistory: [], couponPricesHalved: false, qrCodes: [], qrAccounts: [], qrCodeScans: [], testResults: [], savingsGoals: [], bankQuests: [], journal: { groups: [], students: [], records: [], settings: { reward: 300 } }, mafia: null, accountRequests: [], securityLog: [], auditLog: [], globalMode: { enabled: false, section: null, updatedAt: null }, party: null, guestMode: { enabled: false }, maintenanceMode: { enabled: false }, guestSessions: [], guestQrTokens: [], guestCounter: 0 };
}

function getDefaultMafia() {
    return {
        status: 'idle', // idle | lobby | playing
        config: { doctor: true, commissar: true, mafiaMode: 'auto', duration: 90, allowHostFinish: true, hostMode: 'both' },
        lobbyOpen: false,
        joined: [],
        game: null,
        version: 0
    };
}

function _assignDB(parsed) {
    db = getDefaultDB();
    if (!parsed) return;
    // Merge all fields from parsed data, preserving defaults for missing fields.
    // This ensures new fields added to getDefaultDB() are never lost after a load.
    for (const key of Object.keys(db)) {
        if (parsed.hasOwnProperty(key)) {
            db[key] = parsed[key];
        }
    }
    // Fix nested object that may be null after JSON round-trip
    if (!db.battlePass || typeof db.battlePass !== 'object') {
        db.battlePass = { seasonEnd: null, userProgress: {} };
    }
    if (!db.battlePass.userProgress) db.battlePass.userProgress = {};
    if (!db.globalMode || typeof db.globalMode !== 'object') {
        db.globalMode = { enabled: false, section: null, updatedAt: null };
    }
}

function _runMigrations() {
    // Migration: ensure all users have required fields
    db.users.forEach(u => {
        if (!u.pinHash) { u.pinHash = null; u.salt = null; }
        if (typeof u.balance !== 'number' || !isFinite(u.balance)) u.balance = 0;
        if (!u.createdAt) u.createdAt = Date.now();
        if (u.groupId === undefined) u.groupId = null;
        if (u.nickname === undefined) u.nickname = null;
        if (u.title === undefined) u.title = null;
        if (u.profileIcon === undefined) u.profileIcon = null;
        if (u.adminLevel === undefined) u.adminLevel = null;
        if (u.profilePhoto === undefined) u.profilePhoto = null;
        if (u.neonColor === undefined) u.neonColor = null;
        if (u.nickColor === undefined) u.nickColor = null;
        if (u.archived === undefined) u.archived = false;
        if (u.passwordHash === undefined) { u.passwordHash = null; u.passwordSalt = null; }
    });
    if (!Array.isArray(db.accountRequests)) db.accountRequests = [];
    // Migration: ensure all coupons have image field
    db.coupons.forEach(c => {
        if (c.image === undefined) c.image = null;
    });
    // Migration: ensure all promocodes have rewardType field
    db.promocodes.forEach(p => {
        if (p.rewardType === undefined) p.rewardType = 'percent';
        if (p.fixedAmount === undefined) p.fixedAmount = 0;
    });
    // Migration: halve coupon prices (one-time)
    if (!db.couponPricesHalved) {
        db.coupons.forEach(c => {
            c.price = Math.round(c.price * 0.5);
        });
        db.couponPricesHalved = true;
    }
    // Migration: migrate old QR codes to action-based model
    (db.qrCodes || []).forEach(qr => {
        if (!qr.action) {
            if (qr.operationType === 'reward') qr.action = { operation: 'addMoney', params: { amount: qr.amount } };
            else if (qr.operationType === 'charge') qr.action = { operation: 'withdraw', params: { amount: qr.amount } };
            else if (qr.operationType === 'test') qr.action = { operation: 'sendNotification', params: { title: qr.name, text: 'Тест: ' + qr.name } };
            else qr.action = { operation: 'addMoney', params: { amount: qr.amount || 100 } };
        }
        if (!qr.token) qr.token = crypto.randomBytes(16).toString('hex');
        if (!qr.usageType) qr.usageType = 'limited';
        if (!qr.maxTotalScans) qr.maxTotalScans = qr.maxScansPerUser || 100;
        if (qr.totalScans === undefined) qr.totalScans = 0;
    });
    // Migration: initialize virtual banks if not present
    if (!db.virtualBanks) {
        const now = Date.now();
        db.virtualBanks = [
            { id:'swiss', name:'Mandarin Pro Swiss', icon:'🇨🇭', color:'#ef4444', description:'Виртуальный швейцарский банк Mandarin Pro. Надёжность и стабильность.', rate:105.40, prevRate:102.20, depositPercent:5, terms:[7,14,30,60,90], minDeposit:1000, maxDeposit:1000000, enabled:true, rateHistory:[{rate:100,ts:now-86400000*3},{rate:102.20,ts:now-86400000},{rate:105.40,ts:now}] },
            { id:'cyprus', name:'Mandarin Pro Cyprus', icon:'🇨🇾', color:'#3b82f6', description:'Виртуальный кипрский банк Mandarin Pro. Выгодные условия.', rate:88.20, prevRate:85.50, depositPercent:4, terms:[7,14,30,60,90], minDeposit:500, maxDeposit:500000, enabled:true, rateHistory:[{rate:82,ts:now-86400000*3},{rate:85.50,ts:now-86400000},{rate:88.20,ts:now}] },
            { id:'asia', name:'Mandarin Pro Asia', icon:'🌏', color:'#22c55e', description:'Виртуальный азиатский банк Mandarin Pro. Быстрый рост.', rate:120.50, prevRate:115.00, depositPercent:6, terms:[7,14,30,60,90], minDeposit:2000, maxDeposit:2000000, enabled:true, rateHistory:[{rate:110,ts:now-86400000*3},{rate:115,ts:now-86400000},{rate:120.50,ts:now}] },
            { id:'capital', name:'Mandarin Pro Capital', icon:'🏛️', color:'#a855f7', description:'Виртуальный инвестиционный банк Mandarin Pro. Максимальная доходность.', rate:95.00, prevRate:92.00, depositPercent:3.5, terms:[14,30,60,90], minDeposit:5000, maxDeposit:5000000, enabled:true, rateHistory:[{rate:90,ts:now-86400000*3},{rate:92,ts:now-86400000},{rate:95,ts:now}] }
        ];
    }
    // Migration: mafia module state
    if (!db.mafia || typeof db.mafia !== 'object') {
        db.mafia = getDefaultMafia();
    } else {
        if (!db.mafia.config || typeof db.mafia.config !== 'object') db.mafia.config = getDefaultMafia().config;
        if (!Array.isArray(db.mafia.joined)) db.mafia.joined = [];
        if (db.mafia.version === undefined) db.mafia.version = 0;
    }
}

let _saveDirty = false;
let _saveTimer = null;
let _saveRetryCount = 0;

async function saveDBImmediate() {
    if (usePg) {
        // Never flush uninitialized/empty shell over real Supabase rows
        if (!_dbLoaded) {
            console.error('[PG SAVE BLOCKED] saveDBImmediate() before DB load finished — refuse to overwrite Supabase');
            return;
        }
        if (!db || !Array.isArray(db.users)) {
            console.error('[PG SAVE BLOCKED] in-memory db.users is not an array — refuse to save');
            return;
        }
        const payload = JSON.stringify(db);
        const UPSERT_SQL = "INSERT INTO app_data (key, value) VALUES ('main', $1) ON CONFLICT (key) DO UPDATE SET value = $1";
        try {
            await pool.query(UPSERT_SQL, [payload]);
        } catch (err) {
            console.error('[PG SAVE ERROR]', err.message);
            console.error(err.stack || '');
            // Retry once after short delay
            try {
                await new Promise(r => setTimeout(r, 1000));
                await pool.query(UPSERT_SQL, [payload]);
                console.log('[PG] Save succeeded on retry');
            } catch (err2) {
                console.error('[PG SAVE ERROR RETRY FAILED]', err2.message);
                console.error(err2.stack || '');
                throw err2;
            }
        }
        return;
    }
    // File-based fallback (only when DATABASE_URL is not set)
    if (!_dbLoaded) {
        console.error('[FILE SAVE BLOCKED] saveDBImmediate() before DB load finished — refuse to overwrite file');
        return;
    }
    try {
        const tmp = DB_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
        fs.renameSync(tmp, DB_PATH);
    } catch (err) {
        console.error('[FILE SAVE ERROR]', err.message);
        throw err;
    }
}

function saveDB() {
    if (!_dbLoaded) {
        console.error('[SAVE BLOCKED] saveDB() before DB load finished — ignoring to prevent data wipe');
        return;
    }
    _saveDirty = true;
    if (!_saveTimer) {
        _saveTimer = setTimeout(async () => {
            _saveTimer = null;
            if (_saveDirty) {
                _saveDirty = false;
                try {
                    await saveDBImmediate();
                    _saveRetryCount = 0;
                } catch (err) {
                    console.error('[PG] Debounced save failed:', err.message);
                    _saveDirty = true;
                    _saveRetryCount++;
                    if (_saveRetryCount <= 5) {
                        const delay = Math.min(15000, 1000 * _saveRetryCount);
                        console.error(`[PG] Will retry save in ${delay}ms (attempt ${_saveRetryCount}/5)`);
                        setTimeout(() => saveDB(), delay);
                    } else {
                        console.error('[PG] Giving up on save after 5 retries. Data may be stale in Supabase.');
                    }
                }
            }
        }, 500);
    }
}

(async () => {
    if (usePg) {
        console.log('[PG] Startup: PostgreSQL path selected — will create app_data and load key=main');
    } else {
        console.warn('[PG] Startup: file storage path (no DATABASE_URL resolved)');
    }

    let started = false;
    const maxAttempts = usePg ? 8 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await initDB();
            await loadDB();
            if (!_dbLoaded) {
                throw new Error('loadDB finished but _dbLoaded is false');
            }
            started = true;
            break;
        } catch (err) {
            console.error(`[PG] Startup DB attempt ${attempt}/${maxAttempts} failed:`, err.message);
            console.error(err.stack || '');
            if (attempt < maxAttempts) {
                const delay = Math.min(30000, 2000 * attempt);
                console.warn(`[PG] Retrying DB init/load in ${delay}ms (server will not wipe data)…`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    if (started) {
        initDefaultCoupons();
        initDefaultQuests();
        initDefaultTasks();
        console.log('[PG] MANDARIN PRO database ready, users:', db.users.length, 'storage:', usePg ? 'postgresql' : 'file');
    } else {
        // Do NOT exit — keep serving, but never save uninitialized/empty shell
        console.error('[PG][WARN] DB not loaded after retries. Starting HTTP anyway. Saves stay BLOCKED until load succeeds.');
        _dbLoaded = false;
        // Background retry until Supabase/PG becomes available
        (async function retryLoadLoop() {
            while (!_dbLoaded) {
                await new Promise(r => setTimeout(r, 30000));
                try {
                    await initDB();
                    await loadDB();
                    if (_dbLoaded) {
                        initDefaultCoupons();
                        initDefaultQuests();
                        initDefaultTasks();
                        console.log('[PG] Late DB load succeeded, users:', db.users.length);
                    }
                } catch (e) {
                    console.error('[PG] Background load retry failed:', e.message);
                }
            }
        })();
    }
    // Добиваем баллы за уже сохранённые оценки журнала
    try { backfillJournalAwards(); } catch (e) { console.error('[journal] startup backfill', e.message); }
    startHttpServer();
})();

// --- Default Coupons ---
function initDefaultCoupons() {
    if (db.coupons.length > 0) return;
    const defaults = [
        { name: '📝 «Домашка −30%»', description: 'Домашнее задание уменьшается на 30%.', price:2250, category: 'easy', icon: '📝', durationDays: 7 },
        { name: '📚 «Домашка −50%»', description: 'Домашнее задание уменьшается наполовину.', price:3600, category: 'easy', icon: '📚', durationDays: 7 },
        { name: '🎒 «Мини-домашка»', description: 'Учитель даёт только самое необходимое задание.', price:3000, category: 'easy', icon: '🎒', durationDays: 7 },
        { name: '🐼 «Панда отдыхает»', description: '5 минут отдыха на уроке.', price:2250, category: 'easy', icon: '🐼', durationDays: 7 },
        { name: '🍵 «Чайная пауза»', description: 'Дополнительные 5 минут отдыха.', price:2550, category: 'easy', icon: '🍵', durationDays: 7 },
        { name: '🎧 «Музыкальная минутка»', description: '5 минут китайской музыки на уроке.', price:2250, category: 'easy', icon: '🎧', durationDays: 7 },
        { name: '🀄 «Ма-цзян»', description: '5 минут небольшой игры/развлечения на китайском.', price:2550, category: 'easy', icon: '🀄', durationDays: 7 },
        { name: '🐉 «Драконья пауза»', description: '10 минут отдыха.', price:4500, category: 'easy', icon: '🐉', durationDays: 7 },
        { name: '😊 «Сегодня можно ошибаться»', description: 'Учитель даёт дополнительную попытку при одном сложном задании.', price:3000, category: 'easy', icon: '😊', durationDays: 7 },
        { name: '✏️ «Минус одно задание»', description: 'Одно небольшое задание можно пропустить.', price:3000, category: 'easy', icon: '✏️', durationDays: 7 },
        { name: '🏮 «Китайский фонарик»', description: 'Можно выбрать одно упражнение на уроке, которое не выполнять.', price:3600, category: 'medium', icon: '🏮', durationDays: 7 },
        { name: '🐼 «Панда не делает домашку»', description: 'Одно небольшое домашнее задание можно пропустить.', price:4500, category: 'medium', icon: '🐼', durationDays: 7 },
        { name: '📖 «Лёгкое чтение»', description: 'Одно упражнение по чтению заменяется более лёгким.', price:3600, category: 'medium', icon: '📖', durationDays: 7 },
        { name: '🎧 «Без аудирования»', description: 'Одно домашнее аудирование можно пропустить.', price:4500, category: 'medium', icon: '🎧', durationDays: 7 },
        { name: '✍️ «Без письменной работы»', description: 'Одно письменное домашнее задание можно пропустить.', price:4500, category: 'medium', icon: '✍️', durationDays: 7 },
        { name: '🗣️ «Говори как хочешь»', description: 'Одно устное задание можно заменить другим.', price:3600, category: 'medium', icon: '🗣️', durationDays: 7 },
        { name: '🔤 «Минус 5 слов»', description: 'Можно не учить 5 слов из текущего списка.', price:3600, category: 'medium', icon: '🔤', durationDays: 7 },
        { name: '🧠 «Мозг отдыхает»', description: 'Одно сложное упражнение заменяется простым.', price:3600, category: 'medium', icon: '🧠', durationDays: 7 },
        { name: '🐉 «Сила дракона»', description: 'Дополнительная попытка в одном задании.', price:4050, category: 'medium', icon: '🐉', durationDays: 7 },
        { name: '🧧 «Красный конверт»', description: 'Учитель выбирает небольшой приятный бонус для ученика.', price:5100, category: 'medium', icon: '🧧', durationDays: 7 },
        { name: '🎓 «Домашка −70%»', description: 'Домашнее задание уменьшается на 70%.', price:6000, category: 'rare', icon: '🎓', durationDays: 7 },
        { name: '🌟 «Домашки почти нет»', description: 'Остаётся только одно самое важное домашнее задание.', price:6600, category: 'rare', icon: '🌟', durationDays: 7 },
        { name: '🐼 «День панды»', description: 'Сегодня только лёгкие задания.', price:7500, category: 'rare', icon: '🐼', durationDays: 7 },
        { name: '🏮 «10 минут свободы»', description: '10 минут свободного времени на уроке.', price:6600, category: 'rare', icon: '🏮', durationDays: 7 },
        { name: '🍜 «Китайский перекус»', description: 'Можно выбрать тему небольшого разговорного задания.', price:5100, category: 'rare', icon: '🍜', durationDays: 7 },
        { name: '🎬 «Китайское кино»', description: 'Часть урока заменяется коротким китайским видео.', price:7500, category: 'rare', icon: '🎬', durationDays: 7 },
        { name: '🎵 «Китайская музыка»', description: 'Можно выбрать китайскую песню для небольшой активности.', price:5100, category: 'rare', icon: '🎵', durationDays: 7 },
        { name: '🗣️ «Главный разговор»', description: 'Ученик выбирает тему разговорной практики.', price:6000, category: 'rare', icon: '🗣️', durationDays: 7 },
        { name: '📚 «Выбираю упражнение»', description: 'Ученик выбирает одно из двух упражнений.', price:5100, category: 'rare', icon: '📚', durationDays: 7 },
        { name: '🧧 «Счастливый конверт»', description: 'Случайный небольшой бонус из категории лёгких купонов.', price:7500, category: 'rare', icon: '🧧', durationDays: 7 },
        { name: '💤 «Сегодня без домашнего задания»', description: 'Полностью освобождает от домашнего задания на один день.', price:10500, category: 'premium', icon: '💤', durationDays: 7 },
        { name: '🐉 «День дракона»', description: 'Можно отказаться от одного сложного задания.', price:9000, category: 'premium', icon: '🐉', durationDays: 7 },
        { name: '🏯 «Императорский отдых»', description: '10 минут дополнительного отдыха.', price:9000, category: 'premium', icon: '🏯', durationDays: 7 },
        { name: '🎯 «Вторая попытка»', description: 'Можно повторно выполнить одно задание.', price:7500, category: 'premium', icon: '🎯', durationDays: 7 },
        { name: '📖 «Пропуск упражнения»', description: 'Можно пропустить одно большое упражнение.', price:7500, category: 'premium', icon: '📖', durationDays: 7 },
        { name: '🧠 «Помощь учителя»', description: 'Учитель даёт дополнительную подсказку при сложном задании.', price:6600, category: 'premium', icon: '🧠', durationDays: 7 },
        { name: '🗣️ «Свободный разговор»', description: 'Можно заменить одно стандартное упражнение разговорной практикой.', price:7500, category: 'premium', icon: '🗣️', durationDays: 7 },
        { name: '🎧 «Выбор аудио»', description: 'Ученик выбирает одно аудирование из нескольких вариантов.', price:6600, category: 'premium', icon: '🎧', durationDays: 7 },
        { name: '✍️ «Спасение от письменной работы»', description: 'Можно заменить одно письменное задание.', price:7500, category: 'premium', icon: '✍️', durationDays: 7 },
        { name: '🐼 «Панда-лайт»', description: 'Урок проходит в облегчённом режиме по заданиям учителя.', price:10500, category: 'premium', icon: '🐼', durationDays: 7 },
        { name: '👑 «Императорский купон»', description: 'Домашнее задание уменьшается на 100%.', price:15000, category: 'special', icon: '👑', durationDays: 14 },
        { name: '🐉 «Дракон защищает»', description: 'Можно один раз отказаться от одного сложного задания.', price:13500, category: 'special', icon: '🐉', durationDays: 14 },
        { name: '🏮 «Большой отдых»', description: '15 минут дополнительного отдыха.', price:13500, category: 'special', icon: '🏮', durationDays: 14 },
        { name: '🐼 «Панда в отпуске»', description: 'Полное освобождение от домашнего задания на один учебный день.', price:15000, category: 'special', icon: '🐼', durationDays: 14 },
        { name: '🧧 «Золотой конверт»', description: 'Ученик получает случайный бонус из редких и премиальных купонов.', price:16500, category: 'special', icon: '🧧', durationDays: 14 },
        { name: '🏯 «Император выбирает»', description: 'Ученик может выбрать любой один доступный лёгкий бонус.', price:13500, category: 'special', icon: '🏯', durationDays: 14 },
        { name: '🌟 «VIP-урок»', description: 'Один урок проходит с максимально комфортным набором заданий.', price:18000, category: 'special', icon: '🌟', durationDays: 14 },
        { name: '🐲 «Благословение дракона»', description: 'Можно получить две дополнительные попытки в течение одного урока.', price:16500, category: 'special', icon: '🐲', durationDays: 14 },
        { name: '👑 «Великая щедрость учителя»', description: 'Полное освобождение от одного большого домашнего задания.', price:18000, category: 'special', icon: '👑', durationDays: 14 },
        { name: '🏆 «Золотая панда»', description: 'Особый купон: учитель самостоятельно выбирает приятный бонус для ученика.', price:22500, category: 'special', icon: '🏆', durationDays: 14 },
        { name: 'Pinduoduo / 拼多多', description: 'Купон Pinduoduo / 拼多多', price: 500, category: 'easy', icon: '🛒', durationDays: 7 },
        { name: 'Pinduoduo / 拼多多', description: 'Купон Pinduoduo / 拼多多', price: 1000, category: 'medium', icon: '🛒', durationDays: 7 }
    ];
    defaults.forEach((c, i) => {
        db.coupons.push({
            id: genId(),
            name: c.name,
            description: c.description,
            price: c.price,
            category: c.category,
            icon: c.icon,
            durationDays: c.durationDays,
            image: null,
            active: true,
            createdAt: Date.now(),
            sortOrder: i
        });
    });
    saveDB();
}

// --- XP & Level System ---
const XP_PER_LEVEL = [0,100,250,450,700,1000,1400,1900,2500,3200,4000,5000,6200,7600,9200,11000,13000,15500,18500,22000,26000,30500,35500,41000,47000,54000,62000,71000,81000,92000,104000,118000,134000,152000,172000,194000,218000,245000,275000,308000,344000];
function getXP(userId) { return db.userXP[userId] || { xp: 0, level: 1, dailyLoginDate: null }; }
function getLevelForXP(xp) {
    let lvl = 1;
    for (let i = 1; i < XP_PER_LEVEL.length; i++) { if (xp >= XP_PER_LEVEL[i]) lvl = i + 1; else break; }
    return lvl;
}
function addXP(userId, amount, reason) {
    if (!db.userXP[userId]) db.userXP[userId] = { xp: 0, level: 1, dailyLoginDate: null };
    const ux = db.userXP[userId];
    const oldLevel = ux.level;
    ux.xp += amount;
    ux.level = getLevelForXP(ux.xp);
    const leveledUp = ux.level > oldLevel;
    saveDB();
    emitToUser(userId, 'xp:update', { xp: ux.xp, level: ux.level, added: amount, reason, leveledUp, oldLevel });
    if (leveledUp) emitToUser(userId, 'xp:levelUp', { level: ux.level, oldLevel });
    return { xp: ux.xp, level: ux.level, leveledUp };
}

// --- Default Quests (HSK3 Universal) ---
function initDefaultQuests() {
    const hasNewQuests = db.quests.some(q => q.title === 'Аудио-разведка');
    if (hasNewQuests) return;
    // Remove old template quests (keep admin-created ones)
    db.quests = db.quests.filter(q => !q.isTemplate);
    const defaults = [
        { title: 'Аудио-разведка', description: 'Прослушать 20 китайских предложений и записать, что было услышано. Студент выбирает материал самостоятельно.', category: 'listening', difficulty: 2, reward: 80, xp: 50, icon: '🎧' },
        { title: 'Пойми смысл', description: 'Прослушать 10–15 коротких фраз на китайском и написать их общий смысл на русском или китайском.', category: 'listening', difficulty: 2, reward: 70, xp: 45, icon: '🧠' },
        { title: 'Повтори за носителем', description: 'Прослушать 10 китайских предложений и повторить каждое вслух, стараясь максимально повторить произношение и интонацию.', category: 'listening', difficulty: 2, reward: 75, xp: 45, icon: '🗣️' },
        { title: 'Собери предложение', description: 'Самостоятельно составить 10 правильных китайских предложений из любых знакомых слов.', category: 'sentences', difficulty: 2, reward: 70, xp: 40, icon: '🧩' },
        { title: '20 предложений за один квест', description: 'Написать 20 собственных предложений на китайском без использования готовых шаблонов.', category: 'sentences', difficulty: 3, reward: 100, xp: 65, icon: '📝' },
        { title: 'Только глаголы', description: 'Составить 10 предложений, в которых используются разные китайские глаголы. Слова студент выбирает самостоятельно.', category: 'grammar', difficulty: 2, reward: 70, xp: 40, icon: '⚡' },
        { title: 'Опиши свой день', description: 'Написать на китайском небольшой рассказ о своём обычном дне.', category: 'sentences', difficulty: 2, reward: 75, xp: 45, icon: '☀️' },
        { title: 'Перевод без подсказки', description: 'Самостоятельно перевести 10 предложений с русского на китайский без использования словаря или подсказок.', category: 'translation', difficulty: 3, reward: 85, xp: 55, icon: '🌐' },
        { title: 'Китайский на слух', description: 'Посмотреть или прослушать любой китайский материал и выписать минимум 15 слов или фраз, которые студент смог распознать.', category: 'listening', difficulty: 2, reward: 75, xp: 45, icon: '👂' },
        { title: 'Исправь себя', description: 'Написать 10 китайских предложений, самостоятельно проверить их и исправить найденные ошибки.', category: 'grammar', difficulty: 3, reward: 80, xp: 50, icon: '🔍' },
        { title: 'Мини-диалог', description: 'Самостоятельно создать диалог на китайском минимум из 10 реплик на свободную тему.', category: 'dialogue', difficulty: 2, reward: 80, xp: 50, icon: '💬' },
        { title: 'История из головы', description: 'Написать короткую историю на китайском минимум из 100 иероглифов, используя только самостоятельно выбранную лексику.', category: 'sentences', difficulty: 4, reward: 120, xp: 80, icon: '📖' },
        { title: 'Говорящий квест', description: 'Записать голосовое сообщение на китайском продолжительностью 2–3 минуты на свободную тему.', category: 'dialogue', difficulty: 3, reward: 90, xp: 55, icon: '🎤' },
        { title: 'Чтение с пониманием', description: 'Прочитать любой китайский текст подходящего уровня и ответить своими словами минимум на 5 вопросов по содержанию.', category: 'reading', difficulty: 2, reward: 75, xp: 45, icon: '📚' },
        { title: 'Китайский без остановки', description: 'В течение 5 минут говорить или писать на китайском на одну выбранную тему, стараясь не переходить на русский язык.', category: 'sentences', difficulty: 3, reward: 85, xp: 55, icon: '🚀' }
    ];
    defaults.forEach((q, i) => {
        db.quests.push({
            id: genId(), title: q.title, description: q.description,
            category: q.category, difficulty: q.difficulty,
            reward: q.reward, xp: q.xp, icon: q.icon,
            isTemplate: true, active: true, createdAt: Date.now(), sortOrder: i
        });
    });
    saveDB();
}

// --- Default Tasks ---
// --- Default Tasks (HSK3 Universal) ---
function initDefaultTasks() {
    const hasNewTasks = db.taskAssignments.some(t => t.title === 'Вспомни занятия');
    if (hasNewTasks) return;
    // Remove old template tasks (keep admin-created ones)
    db.taskAssignments = db.taskAssignments.filter(t => !t.isTemplate);
    const defaults = [
        { title: 'Вспомни занятия', description: 'Написать все китайские предложения, которые студент сегодня помнит из занятий.', category: 'sentences', difficulty: 2, reward: 80, xp: 50, icon: '🧠' },
        { title: '10 предложений о сегодня', description: 'Написать 10 собственных предложений о сегодняшнем дне на китайском.', category: 'sentences', difficulty: 2, reward: 75, xp: 45, icon: '📅' },
        { title: 'Рассказ о семье', description: 'Написать небольшой текст о своей семье на китайском.', category: 'sentences', difficulty: 2, reward: 80, xp: 50, icon: '👨‍👩‍👧' },
        { title: 'Мой обычный день', description: 'Описать свой обычный день минимум в 10 предложениях на китайском.', category: 'sentences', difficulty: 2, reward: 80, xp: 50, icon: '☀️' },
        { title: 'Что было вчера', description: 'Написать короткий рассказ о том, что студент делал вчера.', category: 'sentences', difficulty: 2, reward: 75, xp: 45, icon: '🌙' },
        { title: 'Планы на завтра', description: 'Написать, что студент планирует делать завтра, на китайском.', category: 'sentences', difficulty: 1, reward: 65, xp: 40, icon: '📆' },
        { title: 'Собственный диалог', description: 'Создать собственный китайский диалог минимум из 10 реплик.', category: 'dialogue', difficulty: 3, reward: 90, xp: 55, icon: '💬' },
        { title: '10 переводов', description: 'Перевести самостоятельно 10 любых предложений с русского на китайский.', category: 'translation', difficulty: 2, reward: 75, xp: 45, icon: '🌐' },
        { title: '15 вопросов на китайском', description: 'Написать 15 вопросов на китайском, которые можно задать другому человеку.', category: 'grammar', difficulty: 2, reward: 80, xp: 50, icon: '❓' },
        { title: 'Ответь на свои вопросы', description: 'Ответить на 10 самостоятельно придуманных вопросов на китайском.', category: 'grammar', difficulty: 2, reward: 75, xp: 45, icon: '💡' },
        { title: 'Аудирование и запись', description: 'Послушать китайскую речь и записать всё, что удалось понять.', category: 'listening', difficulty: 2, reward: 75, xp: 45, icon: '🎧' },
        { title: 'Чтение и пересказ', description: 'Прочитать китайский текст и кратко пересказать его своими словами.', category: 'reading', difficulty: 2, reward: 80, xp: 50, icon: '📖' },
        { title: 'Голосовое 2 минуты', description: 'Записать голосовое сообщение на китайском на 2 минуты на свободную тему.', category: 'dialogue', difficulty: 3, reward: 85, xp: 50, icon: '🎤' },
        { title: 'Рассказ по картинке', description: 'Написать небольшой рассказ на китайском по любой фотографии или изображению.', category: 'sentences', difficulty: 2, reward: 75, xp: 45, icon: '🖼️' },
        { title: '20 конструкций', description: 'Написать 20 китайских предложений, используя разные типы конструкций.', category: 'grammar', difficulty: 3, reward: 95, xp: 60, icon: '🏗️' },
        { title: 'Найди и исправь ошибки', description: 'Найти ошибки в собственном китайском тексте и самостоятельно их исправить.', category: 'grammar', difficulty: 3, reward: 85, xp: 50, icon: '🔍' },
        { title: '10 разных глаголов', description: 'Написать 10 предложений, используя разные глаголы.', category: 'grammar', difficulty: 2, reward: 75, xp: 45, icon: '⚡' },
        { title: 'Любимое место', description: 'Написать небольшой рассказ о своём любимом месте, городе или стране.', category: 'sentences', difficulty: 2, reward: 80, xp: 50, icon: '🌍' },
        { title: 'Мини-сочинение 100 иероглифов', description: 'Написать мини-сочинение на свободную тему минимум из 100 иероглифов.', category: 'sentences', difficulty: 4, reward: 120, xp: 80, icon: '📝' },
        { title: 'Всё что помнишь', description: 'Написать всё, что студент может вспомнить на китайском за последние несколько занятий: слова, выражения, предложения и грамматические конструкции.', category: 'sentences', difficulty: 3, reward: 100, xp: 65, icon: '🧠' }
    ];
    defaults.forEach((t, i) => {
        db.taskAssignments.push({
            id: genId(), title: t.title, description: t.description,
            category: t.category, difficulty: t.difficulty,
            reward: t.reward, xp: t.xp, icon: t.icon,
            isTemplate: true, active: true, createdAt: Date.now(), sortOrder: i,
            assignedTo: [], assignedGroup: null
        });
    });
    saveDB();
}

// --- Helpers ---

function genId() { return crypto.randomUUID(); }

function sanitizeName(name) {
    if (typeof name !== 'string') return '';
    return name.replace(/[<>&"']/g, '').trim();
}

// --- Session Management ---
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createSession(userId) {
    // Remove old sessions for this user (max 5 per user)
    const userSessions = db.sessions.filter(s => s.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
    while (userSessions.length >= 5) {
        const old = userSessions.pop();
        db.sessions = db.sessions.filter(s => s.id !== old.id);
    }
    const token = crypto.randomBytes(32).toString('hex');
    const session = { id: genId(), userId, token, createdAt: Date.now(), lastUsed: Date.now() };
    db.sessions.push(session);
    saveDB();
    return session;
}

function validateSession(token) {
    if (!token) return null;
    const session = db.sessions.find(s => s.token === token);
    if (!session) return null;
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        db.sessions = db.sessions.filter(s => s.id !== session.id);
        saveDB();
        return null;
    }
    session.lastUsed = Date.now();
    return session;
}

function removeSession(token) {
    db.sessions = db.sessions.filter(s => s.token !== token);
    saveDB();
}

// --- Guest / Maintenance / Guest-QR helpers ---
const GUEST_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

function ensureGuestState() {
    if (!db.guestMode || typeof db.guestMode !== 'object') db.guestMode = { enabled: false };
    if (!db.maintenanceMode || typeof db.maintenanceMode !== 'object') db.maintenanceMode = { enabled: false };
    if (!Array.isArray(db.guestSessions)) db.guestSessions = [];
    if (!Array.isArray(db.guestQrTokens)) db.guestQrTokens = [];
    if (typeof db.guestCounter !== 'number') db.guestCounter = 0;
}

function isMaintenanceEnabled() {
    ensureGuestState();
    return !!db.maintenanceMode.enabled;
}

function isGuestModeEnabled() {
    ensureGuestState();
    return !!db.guestMode.enabled;
}

function cleanupExpiredGuests() {
    ensureGuestState();
    const now = Date.now();
    let dirty = false;
    // expired guest QR tokens
    const beforeQr = db.guestQrTokens.length;
    db.guestQrTokens = db.guestQrTokens.filter(t => t && !t.used && t.expiresAt > now);
    if (db.guestQrTokens.length !== beforeQr) dirty = true;
    // expired guest sessions → remove session + temporary user
    const expired = db.guestSessions.filter(s => s && s.expiresAt <= now);
    for (const g of expired) {
        db.sessions = db.sessions.filter(s => s.token !== g.token);
        if (g.userId) {
            const u = findUser(g.userId);
            if (u && u.isGuest) {
                db.users = db.users.filter(x => x.id !== g.userId);
                db.userXP = db.userXP || {};
                delete db.userXP[g.userId];
            }
        }
    }
    if (expired.length) {
        db.guestSessions = db.guestSessions.filter(s => s && s.expiresAt > now);
        dirty = true;
    }
    // guest users without live session
    for (const u of db.users.filter(x => x && x.isGuest)) {
        const live = db.guestSessions.some(s => s.userId === u.id && s.expiresAt > now);
        if (!live) {
            db.users = db.users.filter(x => x.id !== u.id);
            db.sessions = db.sessions.filter(s => s.userId !== u.id);
            dirty = true;
        }
    }
    if (dirty) saveDB();
    return dirty;
}

function createGuestSession(userId, token) {
    ensureGuestState();
    const expiresAt = Date.now() + GUEST_SESSION_TTL_MS;
    db.guestSessions.push({ id: genId(), userId, token, createdAt: Date.now(), expiresAt });
    return expiresAt;
}

function findGuestSessionByToken(token) {
    ensureGuestState();
    return db.guestSessions.find(s => s.token === token && s.expiresAt > Date.now()) || null;
}

function isGuestUser(userId) {
    const u = findUser(userId);
    return !!(u && u.isGuest);
}

function guestBlocked() {
    return { success: false, message: 'Гостям доступны только игры и комнаты.' };
}

function denyIfGuestOrMaintenance(socket, eventName) {
    const uid = socketUserMap.get(socket.id);
    if (isMaintenanceEnabled()) {
        socket.emit('maintenance:blocked', { message: 'Ведутся технические работы. Пожалуйста, зайдите позже.' });
        return true;
    }
    if (uid && isGuestUser(uid)) {
        socket.emit(eventName || 'error', guestBlocked());
        return true;
    }
    return false;
}

function maintenanceBlocked() {
    return { success: false, maintenance: true, message: 'Ведутся технические работы. Пожалуйста, зайдите позже.' };
}

function emitMaintenanceState() {
    ensureGuestState();
    const payload = { enabled: !!db.maintenanceMode.enabled, updatedAt: db.maintenanceMode.updatedAt || null };
    for (const socketId of socketUserMap.keys()) {
        io.to(socketId).emit('maintenance:state', payload);
    }
    for (const sid of adminSockets) {
        io.to(sid).emit('maintenance:state', payload);
    }
}

function emitGuestModeState() {
    ensureGuestState();
    const payload = { enabled: !!db.guestMode.enabled, updatedAt: db.guestMode.updatedAt || null };
    for (const sid of adminSockets) {
        io.to(sid).emit('guestMode:state', payload);
    }
}

function findUser(id) { return db.users.find(u => u.id === id); }
function findUserByName(name) { return db.users.find(u => u.name === name); }
function isUserBlocked(userId) { const now = Date.now(); return db.userBlocks.find(b => b.userId === userId && (b.expiresAt === null || b.expiresAt > now)) || null; }

// --- Security: login rate limit & threat log ---
const loginAttempts = new Map(); // key -> { count, firstAt, lockedUntil }
const LOGIN_MAX_FAILS = 8;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function clientKey(socket, userId) {
    const ip = (socket && socket.handshake && (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address)) || 'unknown';
    return String(userId || 'anon') + '|' + String(ip).split(',')[0].trim();
}

function loginLockRemaining(key) {
    const e = loginAttempts.get(key);
    if (!e || !e.lockedUntil) return 0;
    return e.lockedUntil > Date.now() ? e.lockedUntil - Date.now() : 0;
}

function registerLoginFail(key, label) {
    const now = Date.now();
    let e = loginAttempts.get(key);
    if (!e || now - e.firstAt > LOGIN_WINDOW_MS) {
        e = { count: 0, firstAt: now, lockedUntil: 0 };
        loginAttempts.set(key, e);
    }
    e.count++;
    if (e.count >= LOGIN_MAX_FAILS) {
        e.lockedUntil = now + LOGIN_LOCK_MS;
        logSecurityEvent('login_lock', label, 'Превышен лимит попыток входа (' + e.count + ')');
        notifyAdminsThreat('🔐 Блокировка входа', (label || 'Неизвестный') + ': превышен лимит попыток входа');
    }
    return e;
}

function clearLoginFails(key) {
    loginAttempts.delete(key);
}

function logSecurityEvent(type, target, details) {
    if (!Array.isArray(db.securityLog)) db.securityLog = [];
    const entry = {
        id: genId(),
        type: String(type || 'unknown'),
        target: target == null ? null : String(target).slice(0, 120),
        details: String(details || '').slice(0, 300),
        timestamp: Date.now()
    };
    db.securityLog.push(entry);
    if (db.securityLog.length > 500) db.securityLog = db.securityLog.slice(-500);
    console.warn('[SECURITY]', entry.type, entry.target || '', entry.details);
    appendAudit({
        actorRole: 'system',
        action: 'security_' + entry.type,
        target: entry.target,
        result: 'error',
        source: 'security',
        reason: entry.details
    });
    try { saveDB(); } catch (e) { }
    return entry;
}

function notifyAdminsThreat(title, body) {
    try {
        for (const sid of adminSockets) {
            io.to(sid).emit('security:threat', { title: String(title || 'Угроза'), body: String(body || ''), timestamp: Date.now() });
        }
    } catch (e) { }
}

function sanitizeImageSrc(src) {
    if (src == null || src === '') return null;
    if (typeof src !== 'string') return null;
    const s = src.trim();
    if (!s) return null;
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(s) && s.length <= 3000000) {
        // SVG data-urls are allowed as images; browsers do not execute scripts in <img>
        return s;
    }
    return null;
}

function isSafeHttpUrl(raw) {
    if (typeof raw !== 'string') return false;
    const s = raw.trim();
    if (!s || s.length > 2048) return false;
    if (/^(javascript|data|vbscript|file|about|blob):/i.test(s)) return false;
    try {
        const u = new URL(s);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}

// Public user data for OTHER users (no balance, no PIN)
function publicUserLight(u, onlineIds) {
    const ux = db.userXP[u.id] || { xp: 0, level: 1 };
    const bp = db.battlePass.userProgress[u.id];
    return {
        id: u.id,
        name: u.name,
        createdAt: u.createdAt,
        lastActive: u.lastActive || u.createdAt,
        online: onlineIds ? onlineIds.has(u.id) : false,
        groupId: u.groupId || null,
        level: u.adminLevel || ux.level,
        profileColor: u.profileColor || null,
        nickname: u.nickname || null,
        customTitle: u.title || null,
        profileIcon: u.profileIcon || null,
        adminLevel: u.adminLevel || null,
        currentTitle: bp ? bp.currentTitle : null,
        currentColor: bp ? bp.currentColor : null,
        currentIcon: bp ? bp.currentIcon : null,
        profilePhoto: u.profilePhoto || null,
        neonColor: u.neonColor || null,
        nickColor: u.nickColor || null
    };
}

// Public user data for the USER THEMSELVES (with balance)
function publicUserFull(u, onlineIds) {
    const ux = db.userXP[u.id] || { xp: 0, level: 1 };
    const bp = db.battlePass.userProgress[u.id];
    return {
        id: u.id,
        name: u.name,
        balance: u.balance,
        createdAt: u.createdAt,
        lastActive: u.lastActive || u.createdAt,
        online: onlineIds ? onlineIds.has(u.id) : false,
        hasPin: !!(u.pinHash),
        hasPassword: !!(u.passwordHash),
        groupId: u.groupId || null,
        xp: ux.xp,
        level: u.adminLevel || ux.level,
        profileColor: u.profileColor || null,
        nickname: u.nickname || null,
        customTitle: u.title || null,
        profileIcon: u.profileIcon || null,
        adminLevel: u.adminLevel || null,
        currentTitle: bp ? bp.currentTitle : null,
        currentColor: bp ? bp.currentColor : null,
        currentIcon: bp ? bp.currentIcon : null,
        profilePhoto: u.profilePhoto || null,
        neonColor: u.neonColor || null,
        nickColor: u.nickColor || null,
        isGuest: !!u.isGuest,
        guestExpiresAt: u.guestExpiresAt || null
    };
}

// Admin view (with balance, no PIN)
function publicUserAdmin(u, onlineIds) {
    const ux = db.userXP[u.id] || { xp: 0, level: 1 };
    const bp = db.battlePass.userProgress[u.id];
    return {
        id: u.id,
        name: u.name,
        balance: u.balance,
        createdAt: u.createdAt,
        lastActive: u.lastActive || u.createdAt,
        online: onlineIds ? onlineIds.has(u.id) : false,
        hasPin: !!(u.pinHash),
        hasPassword: !!(u.passwordHash),
        groupId: u.groupId || null,
        xp: ux.xp,
        level: u.adminLevel || ux.level,
        profileColor: u.profileColor || null,
        nickname: u.nickname || null,
        customTitle: u.title || null,
        profileIcon: u.profileIcon || null,
        adminLevel: u.adminLevel || null,
        currentTitle: bp ? bp.currentTitle : null,
        currentColor: bp ? bp.currentColor : null,
        currentIcon: bp ? bp.currentIcon : null,
        profilePhoto: u.profilePhoto || null,
        neonColor: u.neonColor || null,
        nickColor: u.nickColor || null,
        archived: !!u.archived
    };
}

// --- Online Tracking ---

const socketUserMap = new Map(); // socketId -> userId
const adminSockets = new Set();
const adminSessions = new Map(); // token -> expiresAt (ms)
const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000; // 12 hours
const socketIdMap = new Map(); // userId -> Set<socketId>
const lastSeenMap = new Map(); // userId -> timestamp of last activity
const ONLINE_TIMEOUT_MS = 60 * 1000; // 1 minute — grace period after last socket closes

function createAdminSessionToken() {
    const token = crypto.randomBytes(24).toString('hex');
    adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL);
    return token;
}
function validateAdminSessionToken(token) {
    if (!token || typeof token !== 'string') return false;
    const exp = adminSessions.get(token);
    if (!exp) return false;
    if (Date.now() > exp) { adminSessions.delete(token); return false; }
    return true;
}
function pruneAdminSessions() {
    const now = Date.now();
    for (const [t, exp] of adminSessions) {
        if (now > exp) adminSessions.delete(t);
    }
}

// A user is online ONLY if they have at least one active socket connection
function getOnlineUserIds() {
    return new Set(socketUserMap.values());
}
function getOnlineCount() { return getOnlineUserIds().size; }
function isAdmin(socketId) { return adminSockets.has(socketId); }

function getGlobalMode() {
    if (!db.globalMode || typeof db.globalMode !== 'object') {
        db.globalMode = { enabled: false, section: null, updatedAt: null };
    }
    return db.globalMode;
}
function publicGlobalMode() {
    const g = getGlobalMode();
    return { enabled: !!g.enabled, section: g.section || null, updatedAt: g.updatedAt || null };
}
function broadcastGlobalMode() {
    io.emit('globalMode:changed', publicGlobalMode());
}
function touchUser(user) { user.lastActive = Date.now(); }
function markUserSeen(userId) { if (userId) lastSeenMap.set(userId, Date.now()); }

function getUserSockets(userId) {
    return socketIdMap.get(userId) || new Set();
}

function addSocketUser(socketId, userId) {
    socketUserMap.set(socketId, userId);
    if (!socketIdMap.has(userId)) socketIdMap.set(userId, new Set());
    socketIdMap.get(userId).add(socketId);
    lastSeenMap.delete(userId); // user is actively connected, no need for lastSeen
}

function removeSocket(socketId) {
    const userId = socketUserMap.get(socketId);
    if (userId) {
        const set = socketIdMap.get(userId);
        if (set) {
            set.delete(socketId);
            if (set.size === 0) {
                socketIdMap.delete(userId);
                // No more sockets for this user — record last seen for grace period
                lastSeenMap.set(userId, Date.now());
            }
        }
    }
    socketUserMap.delete(socketId);
    adminSockets.delete(socketId);
}

// --- Emit to specific user (all their sockets) ---

function emitToUser(userId, event, data) {
    const sockets = getUserSockets(userId);
    for (const sid of sockets) {
        io.to(sid).emit(event, data);
    }
}

// --- Personalized bank:update ---

function emitBankUpdate() {
    const onlineIds = getOnlineUserIds();
    for (const [socketId, userId] of socketUserMap.entries()) {
        const user = findUser(userId);
        if (!user) continue;
        const isAdm = isAdmin(socketId);
        const usersList = db.users.filter(u => isAdm || !u.archived).map(u => {
            if (u.id === userId) return publicUserFull(u, onlineIds);
            if (isAdm) return publicUserAdmin(u, onlineIds);
            return publicUserLight(u, onlineIds);
        });
        io.to(socketId).emit('bank:update', {
            users: usersList,
            onlineCount: getOnlineCount(),
            me: publicUserFull(user, onlineIds),
            groups: getAllGroups(),
            groupPermissions: db.groupPermissions,
            globalMode: publicGlobalMode()
        });
    }
    // Also emit to admin sockets that don't have a user mapped
    for (const sid of adminSockets) {
        if (!socketUserMap.has(sid)) {
            const usersList = db.users.map(u => publicUserAdmin(u, onlineIds));
            io.to(sid).emit('bank:update', {
                users: usersList,
                onlineCount: getOnlineCount(),
                me: null,
                groups: getAllGroups(),
                groupPermissions: db.groupPermissions,
                globalMode: publicGlobalMode()
            });
        }
    }
}

// --- Content safety: URLs & attachments ---
const URL_RE = /(https?:\/\/|www\.|javascript:|data:text\/html|vbscript:|<a\s|<img\s|<iframe|[\w.-]+\.(com|net|org|ru|io|xyz|top|club|info|biz|cc|tv|me|su|tk|ml|cf|ga|gq|pw|online|site|shop|fun|icu|live|pro|store|app|dev|tech|space|click|link|download|zip|exe)\b)/i;

function textHasUrl(text) {
    return URL_RE.test(String(text == null ? '' : text));
}

function payloadHasAttachment(data) {
    if (!data || typeof data !== 'object') return false;
    const keys = ['file', 'attachment', 'attachments', 'photo', 'image', 'images', 'base64', 'blob', 'files', 'media', 'sticker', 'voice', 'video'];
    for (const k of keys) {
        const v = data[k];
        if (v == null || v === '' || v === false) continue;
        if (typeof v === 'string') {
            if (/^data:/i.test(v) || v.length > 2000) return true;
            continue;
        }
        if (Array.isArray(v) && v.length) return true;
        if (typeof v === 'object' && Object.keys(v).length) return true;
    }
    return false;
}

function sanitizeTextNoUrl(raw, maxLen) {
    let s = String(raw == null ? '' : raw);
    if (payloadHasAttachment({ text: s }) || textHasUrl(s)) return null;
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (maxLen) s = s.slice(0, maxLen);
    return s;
}

// --- Immutable-style audit log (append-only on server) ---
function ensureAuditLog() {
    if (!Array.isArray(db.auditLog)) db.auditLog = [];
    return db.auditLog;
}

function auditHash(prevHash, payload) {
    return crypto.createHash('sha256')
        .update(String(prevHash || '') + '|' + JSON.stringify(payload))
        .digest('hex')
        .slice(0, 32);
}

function appendAudit(entry) {
    try {
        const log = ensureAuditLog();
        const prev = log.length ? log[log.length - 1] : null;
        const rec = {
            id: genId(),
            ts: Date.now(),
            actorId: entry.actorId || null,
            actorName: entry.actorName || null,
            actorRole: entry.actorRole || 'system',
            action: String(entry.action || 'unknown'),
            target: entry.target == null ? null : String(entry.target).slice(0, 160),
            oldValue: entry.oldValue == null ? null : String(entry.oldValue).slice(0, 200),
            newValue: entry.newValue == null ? null : String(entry.newValue).slice(0, 200),
            result: entry.result === 'error' ? 'error' : 'success',
            source: entry.source || 'system',
            reason: entry.reason ? String(entry.reason).slice(0, 200) : null
        };
        rec.prevHash = prev ? prev.hash : null;
        rec.hash = auditHash(rec.prevHash, rec);
        log.push(rec);
        if (log.length > 2000) db.auditLog = log.slice(-2000);
        try { saveDB(); } catch (e) { }
        return rec;
    } catch (e) {
        console.error('[AUDIT] append failed', e.message);
        return null;
    }
}

// --- Admin History Logging ---

function logAdminAction(action, targetUserId, targetUserName, amount, reason, details) {
    const entry = {
        id: genId(),
        timestamp: Date.now(),
        action,
        targetUserId: targetUserId || null,
        targetUserName: targetUserName || null,
        amount: amount || 0,
        reason: reason || '',
        details: details || ''
    };
    db.adminHistory.push(entry);
    appendAudit({
        actorRole: 'admin',
        action: action,
        target: targetUserName || targetUserId || null,
        newValue: amount ? String(amount) : (details || ''),
        result: 'success',
        source: 'admin_ui',
        reason: reason || null
    });
    return entry;
}

// --- QR Action Engine (shared by QR Terminal + QR Codes) ---

function executeQrAction(operation, targetUserId, params, source) {
    const target = findUser(targetUserId);
    if (!target) throw new Error('Пользователь не найден.');
    const p = params || {};
    const src = source || 'qr';
    const srcLabel = src === 'terminal' ? 'QR-терминал' : src === 'qr_code' ? 'QR-код' : 'Администратор';
    let result = { success: true, operation, userName: target.name, userId: target.id };

    switch (operation) {
        case 'addMoney': {
            const amount = Number(p.amount);
            if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) throw new Error('Некорректная сумма.');
            const oldBalance = target.balance; target.balance += amount; touchUser(target);
            const tx = { id: genId(), type: 'add', userId: target.id, userName: target.name, amount, timestamp: Date.now(), description: srcLabel + ': пополнение', oldBalance, newBalance: target.balance };
            db.history.push(tx);
            logAdminAction('qr_add_money', target.id, target.name, amount, srcLabel, null);
            emitToUser(target.id, 'notification:new', { type: 'received', from: srcLabel, message: 'Пополнение: +' + amount + ' 分', amount });
            result.newBalance = target.balance; result.amount = amount; result.message = '+' + amount + ' 分 начислено!'; break;
        }
        case 'sendMoney': {
            const amount = Number(p.amount);
            if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) throw new Error('Некорректная сумма.');
            const oldBalance = target.balance; target.balance += amount; touchUser(target);
            const tx = { id: genId(), type: 'transfer', from: 'Администратор', to: target.name, fromId: 'admin', toId: target.id, userId: target.id, userName: target.name, amount, timestamp: Date.now(), description: srcLabel + ': перевод от администратора', oldBalance, newBalance: target.balance };
            db.history.push(tx);
            logAdminAction('qr_send_money', target.id, target.name, amount, srcLabel, null);
            emitToUser(target.id, 'notification:new', { type: 'received', from: srcLabel, message: 'Перевод: +' + amount + ' 分', amount });
            result.newBalance = target.balance; result.amount = amount; result.message = '+' + amount + ' 分 переведено!'; break;
        }
        case 'withdraw': {
            const amount = Number(p.amount);
            const reason = (p.reason || '').trim() || 'Изъятие через ' + srcLabel;
            if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) throw new Error('Некорректная сумма.');
            if (target.balance < amount) throw new Error('Недостаточно средств. Баланс: ' + target.balance);
            const oldBalance = target.balance; target.balance -= amount; touchUser(target);
            const tx = { id: genId(), type: 'withdraw', userId: target.id, userName: target.name, amount, timestamp: Date.now(), description: srcLabel + ': изъятие', reason, oldBalance, newBalance: target.balance };
            db.history.push(tx);
            logAdminAction('qr_withdraw', target.id, target.name, amount, reason, null);
            emitToUser(target.id, 'notification:new', { type: 'withdraw', reason, amount });
            result.newBalance = target.balance; result.amount = amount; result.message = '-' + amount + ' 分 изъято'; break;
        }
        case 'fine': {
            const amount = Number(p.amount);
            const reason = (p.reason || '').trim() || 'Штраф через ' + srcLabel;
            if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) throw new Error('Некорректная сумма.');
            if (target.balance < amount) throw new Error('Недостаточно средств. Баланс: ' + target.balance);
            const oldBalance = target.balance; target.balance -= amount; touchUser(target);
            const tx = { id: genId(), type: 'fine', userId: target.id, userName: target.name, amount, timestamp: Date.now(), description: srcLabel + ': штраф', reason, oldBalance, newBalance: target.balance };
            db.history.push(tx);
            logAdminAction('qr_fine', target.id, target.name, amount, reason, null);
            emitToUser(target.id, 'notification:new', { type: 'fine', reason, amount });
            result.newBalance = target.balance; result.amount = amount; result.message = 'Штраф: -' + amount + ' 分'; break;
        }
        case 'editBalance': {
            const newBalance = Number(p.newBalance);
            const reason = (p.reason || '').trim() || 'Корректировка через ' + srcLabel;
            if (!Number.isFinite(newBalance)) throw new Error('Некорректное значение.');
            const oldBalance = target.balance; target.balance = newBalance; touchUser(target);
            const tx = { id: genId(), type: 'edit_balance', userId: target.id, userName: target.name, amount: newBalance - oldBalance, timestamp: Date.now(), description: srcLabel + ': корректировка', reason, oldBalance, newBalance: target.balance };
            db.history.push(tx);
            logAdminAction('qr_edit_balance', target.id, target.name, newBalance - oldBalance, reason, oldBalance + ' -> ' + newBalance);
            emitToUser(target.id, 'notification:new', { type: 'edit', oldBalance, newBalance, reason });
            result.newBalance = target.balance; result.message = 'Баланс изменён: ' + oldBalance + ' → ' + newBalance; break;
        }
        case 'giftCoupon': {
            const couponDef = db.coupons.find(c => c.id === p.couponId);
            if (!couponDef) throw new Error('Купон не найден.');
            const userCoupon = { id: 'coupon_' + target.id.substring(0, 8) + '_' + Date.now().toString(36), couponId: couponDef.id, userId: target.id, userName: target.name, couponName: couponDef.name, couponDescription: couponDef.description, couponIcon: couponDef.icon, couponCategory: couponDef.category, price: 0, status: 'active', source: 'gifted', purchasedAt: Date.now(), activatedAt: null, expiresAt: Date.now() + couponDef.durationDays * 86400000, usedAt: null, giftedBy: 'admin', giftByName: srcLabel };
            db.userCoupons.push(userCoupon);
            db.notifications.push({ id: genId(), targetUserId: target.id, title: '🎁 Подарок — купон!', text: 'Вам подарил купон «' + couponDef.name + '»!', timestamp: Date.now(), read: false, senderName: srcLabel });
            logAdminAction('qr_coupon_gift', target.id, target.name, 0, couponDef.name, srcLabel);
            emitToUser(target.id, 'notification:push', { id: genId(), targetUserId: target.id, title: '🎁 Подарок — купон!', text: 'Вам подарил купон «' + couponDef.name + '»!', timestamp: Date.now(), read: false, senderName: srcLabel });
            emitToUser(target.id, 'coupon:refresh', {});
            result.couponName = couponDef.name; result.message = 'Купон «' + couponDef.name + '» подарен!'; break;
        }
        case 'addInvestment': {
            const invType = p.investmentType || 'science';
            if (!INVESTMENT_TYPES.find(t => t.id === invType)) throw new Error('Неизвестный тип инвестиции.');
            const amount = Number(p.amount);
            if (!Number.isFinite(amount) || amount <= 0) throw new Error('Некорректная сумма.');
            if (!db.investmentPrices[invType]) db.investmentPrices[invType] = 10000;
            const price = db.investmentPrices[invType]; const units = amount / price;
            const investment = { id: genId(), userId: target.id, amount, units, price, type: invType, timestamp: Date.now(), status: 'active' };
            db.investments.push(investment);
            const typeName = INVESTMENT_TYPES.find(t => t.id === invType)?.name || invType;
            logAdminAction('qr_invest', target.id, target.name, amount, typeName, srcLabel);
            emitToUser(target.id, 'notification:new', { type: 'received', from: 'Инвестиции (' + srcLabel + ')', message: 'Инвестиция ' + typeName + ': ' + amount, amount });
            result.investType = typeName; result.amount = amount; result.message = 'Инвестиция ' + typeName + ': ' + amount + ' 分'; break;
        }
        case 'openDeposit': {
            const bank = (db.virtualBanks || []).find(b => b.id === p.bankId && b.enabled);
            if (!bank) throw new Error('Банк не найден.');
            const amount = Number(p.amount); const termDays = Number(p.termDays) || 30;
            if (!Number.isInteger(amount) || amount <= 0) throw new Error('Некорректная сумма.');
            if (amount < bank.minDeposit || amount > bank.maxDeposit) throw new Error('Сумма от ' + bank.minDeposit + ' до ' + bank.maxDeposit + '.');
            if (target.balance < amount) throw new Error('Недостаточно средств. Баланс: ' + target.balance);
            const oldBal = target.balance; target.balance -= amount; touchUser(target);
            const now = Date.now(); const income = Math.round(amount * (bank.depositPercent / 100) * (termDays / 30));
            const dep = { id: genId(), userId: target.id, bankId: bank.id, amount, termDays, percent: bank.depositPercent, startDate: now, endDate: now + termDays * 86400000, expectedIncome: income, status: 'active' };
            db.userBankDeposits.push(dep);
            const tx = { id: genId(), type: 'bank_deposit_open', userId: target.id, userName: target.name, amount, timestamp: now, description: srcLabel + ': депозит в ' + bank.name, oldBalance: oldBal, newBalance: target.balance, bankId: bank.id, depositId: dep.id };
            db.history.push(tx); db.bankHistory.push({ id: genId(), userId: target.id, type: 'deposit_open', bankId: bank.id, amount, termDays, percent: bank.depositPercent, expectedIncome: income, timestamp: now });
            logAdminAction('qr_bank_deposit', target.id, target.name, amount, bank.name, termDays + 'д');
            result.bankName = bank.name; result.newBalance = target.balance; result.amount = amount; result.message = 'Депозит в ' + bank.name + ': ' + amount + ' 分'; break;
        }
        case 'bankInvest': {
            const bank = (db.virtualBanks || []).find(b => b.id === p.bankId && b.enabled);
            if (!bank) throw new Error('Банк не найден.');
            const amount = Number(p.amount);
            if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) throw new Error('Некорректная сумма.');
            if (target.balance < amount) throw new Error('Недостаточно средств. Баланс: ' + target.balance);
            const oldBal = target.balance; target.balance -= amount; touchUser(target);
            const units = amount / bank.rate; const now = Date.now();
            const inv = { id: genId(), userId: target.id, bankId: bank.id, amount, units, buyRate: bank.rate, timestamp: now, status: 'active' };
            db.userBankInvestments.push(inv);
            const tx = { id: genId(), type: 'bank_invest', userId: target.id, userName: target.name, amount, timestamp: now, description: srcLabel + ': инвестиция в ' + bank.name, oldBalance: oldBal, newBalance: target.balance, bankId: bank.id, investmentId: inv.id, units, rate: bank.rate };
            db.history.push(tx); db.bankHistory.push({ id: genId(), userId: target.id, type: 'invest', bankId: bank.id, amount, units, rate: bank.rate, timestamp: now });
            logAdminAction('qr_bank_invest', target.id, target.name, amount, bank.name, units.toFixed(4) + ' ед.');
            result.bankName = bank.name; result.newBalance = target.balance; result.amount = amount; result.message = 'Инвестиция в ' + bank.name + ': ' + amount + ' 分'; break;
        }
        case 'addPoints': {
            const amount = Number(p.amount);
            if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) throw new Error('Некорректное количество.');
            const r = addXP(target.id, amount, srcLabel);
            logAdminAction('qr_add_xp', target.id, target.name, amount, srcLabel, null);
            result.xp = r.xp; result.level = r.level; result.amount = amount; result.message = '+' + amount + ' XP начислено!'; break;
        }
        case 'setLevel': {
            const level = Number(p.level);
            if (!Number.isInteger(level) || level < 1 || level > 40) throw new Error('Некорректный уровень.');
            if (!db.userXP[target.id]) db.userXP[target.id] = { xp: 0, level: 1, dailyLoginDate: null };
            db.userXP[target.id].level = level;
            emitToUser(target.id, 'xp:update', { level, xp: db.userXP[target.id].xp });
            logAdminAction('qr_set_level', target.id, target.name, level, srcLabel, null);
            result.level = level; result.message = 'Уровень установлен: ' + level; break;
        }
        case 'setTitle': {
            const title = (p.title || '').trim();
            if (!title) throw new Error('Введите титул.');
            target.customTitle = title; touchUser(target);
            logAdminAction('qr_set_title', target.id, target.name, 0, title, srcLabel);
            emitToUser(target.id, 'profile:update', { customTitle: title });
            result.title = title; result.message = 'Титул установлен: ' + title; break;
        }
        case 'sendNotification': {
            const text = (p.text || '').trim();
            if (!text) throw new Error('Введите текст.');
            const notif = { id: genId(), targetUserId: target.id, title: p.title || 'Уведомление', text, timestamp: Date.now(), read: false, senderName: srcLabel };
            db.notifications.push(notif);
            logAdminAction('qr_send_notification', target.id, target.name, 0, text, srcLabel);
            emitToUser(target.id, 'notification:push', notif);
            result.text = text; result.message = 'Уведомление отправлено'; break;
        }
        case 'approvePurchase': {
            const req = db.purchaseRequests.find(r => r.id === p.purchaseId && r.userId === target.id && r.status === 'pending');
            if (!req) throw new Error('Заявка на покупку не найдена.');
            if (target.balance < req.amount) throw new Error('Недостаточно средств.');
            const oldBalance = target.balance; target.balance -= req.amount; touchUser(target);
            req.status = 'approved'; req.updatedAt = Date.now(); req.approvedPrice = req.amount;
            const tx = { id: genId(), type: 'purchase', userId: target.id, userName: target.name, amount: req.amount, timestamp: Date.now(), description: srcLabel + ': покупка ' + req.reason, reason: req.reason, oldBalance, newBalance: target.balance };
            db.history.push(tx);
            logAdminAction('qr_approve_purchase', target.id, target.name, req.amount, req.reason, srcLabel);
            result.newBalance = target.balance; result.amount = req.amount; result.reason = req.reason; result.message = 'Покупка одобрена: ' + req.reason; break;
        }
        case 'createPurchase': {
            const amount = Number(p.amount);
            const reason = (p.reason || '').trim();
            if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) throw new Error('Некорректная сумма.');
            if (!reason) throw new Error('Опишите покупку.');
            if (target.balance < amount) throw new Error('Недостаточно средств. Баланс: ' + target.balance);
            const oldBalance = target.balance; target.balance -= amount; touchUser(target);
            const req = { id: genId(), userId: target.id, userName: target.name, amount, reason, status: 'approved', createdAt: Date.now(), updatedAt: Date.now(), approvedPrice: amount };
            db.purchaseRequests.push(req);
            const tx = { id: genId(), type: 'purchase', userId: target.id, userName: target.name, amount, timestamp: Date.now(), description: srcLabel + ': покупка ' + reason, reason, oldBalance, newBalance: target.balance };
            db.history.push(tx);
            logAdminAction('qr_create_purchase', target.id, target.name, amount, reason, srcLabel);
            emitToUser(target.id, 'notification:new', { type: 'purchase', from: srcLabel, message: 'Покупка: ' + reason, amount });
            result.newBalance = target.balance; result.amount = amount; result.reason = reason; result.message = 'Покупка: ' + reason + ' (-' + amount + ' 分)'; break;
        }
        case 'assignQuest': {
            const quest = db.quests.find(q => q.id === p.questId);
            if (!quest) throw new Error('Квест не найден.');
            if (!quest.assignedTo) quest.assignedTo = [];
            if (!quest.assignedTo.includes(target.id)) quest.assignedTo.push(target.id);
            logAdminAction('qr_assign_quest', target.id, target.name, 0, quest.title, srcLabel);
            emitToUser(target.id, 'notification:push', { id: genId(), targetUserId: target.id, title: quest.title, text: quest.description || 'Новый квест', timestamp: Date.now(), read: false, senderName: srcLabel });
            result.questTitle = quest.title; result.message = 'Квест назначен: ' + quest.title; break;
        }
        case 'assignTask': {
            const task = db.taskAssignments.find(t => t.id === p.taskId);
            if (!task) throw new Error('Задание не найдено.');
            if (!task.assignedTo) task.assignedTo = [];
            if (!task.assignedTo.includes(target.id)) task.assignedTo.push(target.id);
            logAdminAction('qr_assign_task', target.id, target.name, 0, task.title, srcLabel);
            emitToUser(target.id, 'notification:push', { id: genId(), targetUserId: target.id, title: task.title, text: task.description || 'Новое задание', timestamp: Date.now(), read: false, senderName: srcLabel, type: 'task_assigned', reward: task.reward, xp: task.xp, taskId: task.id });
            result.taskTitle = task.title; result.message = 'Задание назначено: ' + task.title; break;
        }
        case 'activatePromo': {
            const promo = db.promocodes.find(pr => pr.id === p.promoId);
            if (!promo) throw new Error('Промокод не найден.');
            if (promo.status !== 'active') throw new Error('Промокод отключён.');
            const existing = db.userPromoActivations.find(a => a.promoId === promo.id && a.userId === target.id);
            if (existing) throw new Error('Промокод уже активирован этим пользователем.');
            const isFixed = promo.rewardType === 'fixed';
            const bonusAmount = isFixed ? promo.fixedAmount : Math.floor(target.balance * promo.bonusPercent / 100);
            const oldBalance = target.balance; target.balance += bonusAmount; touchUser(target);
            promo.currentUses = (promo.currentUses || 0) + 1;
            db.userPromoActivations.push({ id: genId(), promoId: promo.id, userId: target.id, userName: target.name, rewardType: promo.rewardType || 'percent', bonusPercent: promo.bonusPercent, fixedAmount: promo.fixedAmount || 0, bonusAmount, oldBalance, newBalance: target.balance, activatedAt: Date.now() });
            const tx = { id: genId(), type: 'promo_bonus', userId: target.id, userName: target.name, amount: bonusAmount, timestamp: Date.now(), description: srcLabel + ': промокод ' + promo.name, oldBalance, newBalance: target.balance };
            db.history.push(tx);
            logAdminAction('qr_activate_promo', target.id, target.name, bonusAmount, promo.name, srcLabel);
            emitToUser(target.id, 'notification:new', { type: 'received', from: 'Промокод (' + srcLabel + ')', message: 'Промокод: +' + bonusAmount + ' 分', amount: bonusAmount });
            result.promoName = promo.name; result.bonusAmount = bonusAmount; result.newBalance = target.balance; result.message = 'Промокод ' + promo.name + ': +' + bonusAmount + ' 分'; break;
        }
        default: throw new Error('Неизвестная операция: ' + operation);
    }
    return result;
}

// --- Approval Request System ---

function createApprovalRequest(type, userId, userName, data) {
    // Duplicate protection: check if a pending request already exists for the same entity
    const existing = db.approvalRequests.find(r => r.type === type && r.status === 'pending' && (
        (type === 'purchase' && data?.purchaseRequestId && r.data?.purchaseRequestId === data.purchaseRequestId) ||
        (type === 'quest' && data?.submissionId && r.data?.submissionId === data.submissionId) ||
        (type === 'task' && data?.submissionId && r.data?.submissionId === data.submissionId) ||
        (type === 'duel' && data?.duelId && r.data?.duelId === data.duelId) ||
        (type === 'coupon' && data?.userCouponId && r.data?.userCouponId === data.userCouponId)
    ));
    if (existing) return existing;
    const req = {
        id: genId(),
        type, // 'purchase', 'quest', 'task', 'duel', 'coupon'
        userId,
        userName,
        status: 'pending', // 'pending', 'approved', 'rejected'
        data: data || {},
        createdAt: Date.now(),
        reviewedAt: null,
        reviewedBy: null,
        adminComment: ''
    };
    db.approvalRequests.push(req);
    saveDB();
    // Notify all admin sockets
    for (const sid of adminSockets) {
        io.to(sid).emit('approval:new', { request: req });
    }
    return req;
}

function updateApprovalRequest(requestId, status, adminComment) {
    const req = db.approvalRequests.find(r => r.id === requestId);
    if (!req) return null;
    if (req.status !== 'pending') return null;
    req.status = status;
    req.reviewedAt = Date.now();
    req.adminComment = adminComment || '';
    saveDB();
    return req;
}

// --- Virtual Banks: Deposit Maturity ---

function checkMaturedDeposits(userId) {
    const now = Date.now();
    let changed = false;
    db.userBankDeposits.filter(d => d.userId === userId && d.status === 'active' && now >= d.endDate).forEach(dep => {
        dep.status = 'completed';
        dep.completedAt = now;
        const user = findUser(dep.userId);
        if (user) {
            const oldBal = user.balance;
            user.balance += dep.amount + dep.expectedIncome;
            touchUser(user);
            const tx = { id: genId(), type: 'bank_deposit_income', userId: user.id, userName: user.name, amount: dep.amount + dep.expectedIncome, timestamp: now, description: 'Доход по депозиту: ' + ((db.virtualBanks || []).find(b => b.id === dep.bankId)?.name || dep.bankId), oldBalance: oldBal, newBalance: user.balance, bankId: dep.bankId, depositId: dep.id };
            db.history.push(tx);
        }
        changed = true;
    });
    if (changed) saveDB();
    return changed;
}

function checkAllMaturedDeposits() {
    const now = Date.now();
    let changed = false;
    db.userBankDeposits.filter(d => d.status === 'active' && now >= d.endDate).forEach(dep => {
        dep.status = 'completed';
        dep.completedAt = now;
        const user = findUser(dep.userId);
        if (user) {
            const oldBal = user.balance;
            user.balance += dep.amount + dep.expectedIncome;
            touchUser(user);
            const tx = { id: genId(), type: 'bank_deposit_income', userId: user.id, userName: user.name, amount: dep.amount + dep.expectedIncome, timestamp: now, description: 'Доход по депозиту: ' + ((db.virtualBanks || []).find(b => b.id === dep.bankId)?.name || dep.bankId), oldBalance: oldBal, newBalance: user.balance, bankId: dep.bankId, depositId: dep.id };
            db.history.push(tx);
        }
        changed = true;
    });
    if (changed) { saveDB(); io.emit('bank:dataChanged'); }
}
setInterval(checkAllMaturedDeposits, 60000);

// --- Journal helpers (module-level: used by socket handlers AND startup backfill) ---
function getAllGroups() {
    const j = getJournalData();
    const seen = new Map();
    for (const g of (j.groups || [])) { if (g && g.id) seen.set(g.id, g); }
    for (const g of (db.groups || [])) { if (g && g.id && !seen.has(g.id)) seen.set(g.id, g); }
    return Array.from(seen.values());
}

function getJournalData() {
    if (!db.journal || typeof db.journal !== 'object') {
        db.journal = { groups: [], students: [], records: [], attendance: [], settings: { reward: 300 } };
    }
    if (!Array.isArray(db.journal.groups)) db.journal.groups = [];
    if (!Array.isArray(db.journal.students)) db.journal.students = [];
    if (!Array.isArray(db.journal.records)) db.journal.records = [];
    if (!Array.isArray(db.journal.attendance)) db.journal.attendance = [];
    if (!db.journal.settings || typeof db.journal.settings !== 'object') db.journal.settings = { reward: 300 };
    if (typeof db.journal.settings.reward !== 'number') db.journal.settings.reward = 300;
    if (!db.journal.awards || typeof db.journal.awards !== 'object') db.journal.awards = {};
    if (!Array.isArray(db.journal.homework)) db.journal.homework = [];
    if (!Array.isArray(db.journal.homeworkSubmissions)) db.journal.homeworkSubmissions = [];
    return db.journal;
}

// --- Exams helpers (Mandarin Pro exams & tests) ---
function getExamsData() {
    if (!db.exams || typeof db.exams !== 'object') {
        db.exams = { exams: [], attempts: [] };
    }
    if (!Array.isArray(db.exams.exams)) db.exams.exams = [];
    if (!Array.isArray(db.exams.attempts)) db.exams.attempts = [];
    return db.exams;
}

function findJournalStudentByUser(userId) {
    if (!userId) return null;
    const j = getJournalData();
    return j.students.find(s => s && (s.userId === userId || s.id === userId)) || null;
}

function sanitizeQuestion(q) {
    if (!q || typeof q !== 'object') return null;
    const options = Array.isArray(q.options) ? q.options.slice(0, 8).map(o => String(o == null ? '' : o).slice(0, 500)) : [];
    return {
        id: String(q.id || genId()),
        text: String(q.text == null ? '' : q.text).slice(0, 5000),
        options,
        answer: String(q.answer == null ? '' : q.answer).slice(0, 500),
        points: Number.isFinite(Number(q.points)) && Number(q.points) > 0 ? Number(q.points) : 1,
        explanation: String(q.explanation == null ? '' : q.explanation).slice(0, 2000)
    };
}

function sanitizeExam(data) {
    const questions = Array.isArray(data.questions) ? data.questions.map(sanitizeQuestion).filter(Boolean) : [];
    return {
        id: String(data.id || genId()),
        title: String(data.title == null ? '' : data.title).slice(0, 200),
        description: String(data.description == null ? '' : data.description).slice(0, 5000),
        instruction: String(data.instruction == null ? '' : data.instruction).slice(0, 5000),
        subject: String(data.subject == null ? 'Китайский язык' : data.subject).slice(0, 100),
        level: String(data.level == null ? '' : data.level).slice(0, 50),
        state: ['Черновик', 'Опубликован', 'Открыт', 'Закрыт', 'Архив'].includes(data.state) ? data.state : 'Опубликован',
        open: String(data.open || ''),
        close: String(data.close || ''),
        minutes: Number.isFinite(Number(data.minutes)) && Number(data.minutes) >= 1 ? Math.min(600, Number(data.minutes)) : 20,
        limit: Number.isFinite(Number(data.limit)) && Number(data.limit) >= 1 ? Math.min(50, Number(data.limit)) : 1,
        pass: Number.isFinite(Number(data.pass)) ? Math.max(0, Math.min(100, Number(data.pass))) : 60,
        reveal: ['after', 'closed', 'never'].includes(data.reveal) ? data.reveal : 'after',
        navigate: data.navigate !== false,
        access: Array.isArray(data.access) ? data.access.map(x => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, 200) : [],
        groupIds: Array.isArray(data.groupIds) ? data.groupIds.map(x => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, 100) : [],
        forAll: data.forAll !== false,
        questions
    };
}

function isExamVisibleToStudent(e, userId, st) {
    if (!e) return false;
    // Drafts / closed / archived are never listed for students
    if (e.state !== 'Открыт' && e.state !== 'Опубликован') return false;
    const access = Array.isArray(e.access) ? e.access.filter(Boolean) : [];
    const groupIds = Array.isArray(e.groupIds) ? e.groupIds.filter(Boolean) : [];
    // Explicit assignment: only matching groups / individuals
    if (groupIds.length || access.length) {
        if (st && st.groupId && groupIds.includes(st.groupId)) return true;
        if (userId && access.includes(userId)) return true;
        if (st && access.includes(st.id)) return true;
        if (st && st.userId && access.includes(st.userId)) return true;
        return false;
    }
    // Published with no assignment (or "for all") → every student sees it
    return true;
}

function validateExam(data) {
    const errors = [];
    if (!data || typeof data !== 'object') { errors.push('Нет данных экзамена.'); return errors; }
    if (!String(data.title || '').trim()) errors.push('Укажите название.');
    const minutes = Number(data.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) errors.push('Время: от 1 до 600 минут.');
    const limit = Number(data.limit);
    if (!Number.isInteger(limit) || limit < 1) errors.push('Число попыток — целое от 1.');
    const pass = Number(data.pass);
    if (!Number.isFinite(pass) || pass < 0 || pass > 100) errors.push('Проходной процент: 0–100.');
    if (data.open && data.close && String(data.open) >= String(data.close)) errors.push('Закрытие должно быть позже открытия.');
    const questions = Array.isArray(data.questions) ? data.questions : [];
    if (!questions.length) errors.push('Добавьте хотя бы один вопрос.');
    questions.forEach((q, i) => {
        const n = i + 1;
        if (!q || !String(q.text || '').trim()) errors.push('Вопрос ' + n + ': нет текста.');
        const opts = Array.isArray(q.options) ? q.options.map(o => String(o || '').trim()).filter(Boolean) : [];
        if (opts.length < 2) errors.push('Вопрос ' + n + ': нужно минимум 2 варианта ответа.');
        const ans = String(q.answer || '').trim();
        if (!ans) errors.push('Вопрос ' + n + ': нет правильного ответа.');
        else if (opts.length && !opts.includes(ans) && !opts.includes(ans.replace(/^[A-Da-d][.)]\s*/, ''))) {
            // allow letter answer A-D mapped later on client; server accepts letter or option text
            if (!/^[A-Da-d]$/.test(ans)) errors.push('Вопрос ' + n + ': ответ должен совпадать с одним из вариантов.');
        }
    });
    return errors;
}

function gradeExamAnswers(exam, answers) {
    const grades = {};
    let score = 0;
    let maxScore = 0;
    for (const q of (exam.questions || [])) {
        const pts = Number(q.points) > 0 ? Number(q.points) : 1;
        maxScore += pts;
        const v = answers ? answers[q.id] : undefined;
        const raw = Array.isArray(v) ? (v[0] || '') : (v == null ? '' : v);
        const letter = String(raw).trim().toUpperCase();
        const opts = (q.options || []).map(o => String(o || '').trim());
        const letterIdx = /^[A-D]$/.test(letter) ? letter.charCodeAt(0) - 65 : -1;
        const selectedText = letterIdx >= 0 ? (opts[letterIdx] || '') : String(raw).trim();

        const ansRaw = String(q.answer || '').trim();
        let correctLetter = '';
        let correctText = '';
        if (/^[A-Da-d]$/.test(ansRaw)) {
            correctLetter = ansRaw.toUpperCase();
            const ci = correctLetter.charCodeAt(0) - 65;
            correctText = opts[ci] || '';
        } else {
            const m = ansRaw.match(/^([A-Da-d])[.)]\s*(.*)$/);
            if (m) {
                correctLetter = m[1].toUpperCase();
                const ci = correctLetter.charCodeAt(0) - 65;
                correctText = opts[ci] || m[2] || '';
            } else {
                const ix = opts.findIndex(o => o === ansRaw);
                correctLetter = ix >= 0 ? 'ABCD'.charAt(ix) : '';
                correctText = ix >= 0 ? opts[ix] : ansRaw;
            }
        }

        let ok = false;
        if (letter && correctLetter && letter === correctLetter) ok = true;
        else if (selectedText && correctText && selectedText === correctText) ok = true;
        else if (selectedText && ansRaw && selectedText === ansRaw) ok = true;

        if (!letter && !selectedText) {
            grades[q.id] = { score: 0, status: 'Пропущено', answer: '', answerText: '', correct: correctText || correctLetter };
        } else {
            grades[q.id] = {
                score: ok ? pts : 0,
                status: ok ? 'Правильно' : 'Неправильно',
                answer: letter || selectedText,
                answerText: selectedText || letter,
                correct: correctText || correctLetter
            };
            if (ok) score += pts;
        }
    }
    return { grades, score, maxScore };
}

function publicExamForStudent(e) {
    // Hide correct answers from students during the attempt
    return Object.assign({}, e, {
        questions: (e.questions || []).map(q => ({
            id: q.id,
            text: q.text,
            options: q.options,
            points: q.points,
            explanation: q.explanation || ''
            // answer intentionally omitted
        }))
    });
}

function publicAttemptForStudent(a) {
    const snap = a.examSnapshot || {};
    const reveal = snap.reveal === 'after' || isAdminAttemptReveal(a);
    return {
        id: a.id,
        examId: a.examId,
        userId: a.userId || null,
        studentId: a.studentId || null,
        studentName: a.studentName || '',
        examSnapshot: {
            id: snap.id,
            title: snap.title,
            pass: snap.pass,
            minutes: snap.minutes,
            reveal: snap.reveal,
            questions: (snap.questions || []).map(q => ({
                id: q.id,
                text: q.text,
                options: q.options,
                points: q.points,
                explanation: (reveal && a.end) ? (q.explanation || '') : ''
            }))
        },
        start: a.start,
        end: a.end || null,
        deadline: a.deadline || null,
        durationSec: a.durationSec,
        answers: a.answers || {},
        grades: a.end ? filterGradesForStudent(a.grades || {}, reveal) : {},
        score: a.score,
        maxScore: a.maxScore,
        percent: a.percent,
        status: a.status,
        number: a.number,
        position: a.position || 0,
        createdAt: a.createdAt || null
    };
}

function isAdminAttemptReveal(a) {
    const snap = a.examSnapshot || {};
    if (snap.reveal === 'closed') {
        const live = getExamsData().exams.find(e => e && e.id === a.examId);
        return !!(live && (live.state === 'Закрыт' || live.state === 'Архив'));
    }
    return false;
}

function filterGradesForStudent(grades, reveal) {
    const out = {};
    for (const key of Object.keys(grades || {})) {
        const g = grades[key] || {};
        out[key] = {
            score: g.score,
            status: g.status,
            answer: g.answer,
            answerText: g.answerText
        };
        if (reveal) {
            out[key].correct = g.correct;
        }
    }
    return out;
}

function emitExamsUpdate() {
    const ex = getExamsData();
    const adminStudents = getJournalData().students.map(s => ({ id: s.id, name: s.name, groupId: s.groupId, userId: s.userId || null }));
    const adminGroups = getAllGroups().map(g => ({ id: g.id, name: g.name }));
    for (const socketId of socketUserMap.keys()) {
        const userId = socketUserMap.get(socketId);
        const admin = isAdmin(socketId);
        if (admin) {
            io.to(socketId).emit('exams:updated', {
                exams: ex.exams,
                attempts: ex.attempts,
                students: adminStudents,
                groups: adminGroups,
                isAdmin: true
            });
        } else if (userId) {
            const st = findJournalStudentByUser(userId);
            const myAttempts = ex.attempts.filter(a => a && (a.userId === userId || (st && a.studentId === st.id)));
            const openExams = ex.exams.filter(e => isExamVisibleToStudent(e, userId, st));
            io.to(socketId).emit('exams:updated', {
                exams: openExams.map(e => publicExamForStudent(e)),
                attempts: myAttempts.map(a => publicAttemptForStudent(a)),
                isAdmin: false
            });
        }
    }
    for (const sid of adminSockets) {
        if (!socketUserMap.has(sid)) {
            io.to(sid).emit('exams:updated', {
                exams: ex.exams,
                attempts: ex.attempts,
                students: adminStudents,
                groups: adminGroups,
                isAdmin: true
            });
        }
    }
}

// --- Parent token / attendance helpers ---
function generateParentToken() {
    return crypto.randomBytes(24).toString('hex');
}

function ensureParentToken(student) {
    if (!student) return null;
    if (!student.parentToken) student.parentToken = generateParentToken();
    return student.parentToken;
}

function findStudentByParentToken(token) {
    if (!token || typeof token !== 'string') return null;
    const j = getJournalData();
    return j.students.find(s => s && s.parentToken === token) || null;
}

function studentAttendanceStats(list) {
    const stats = { present: 0, absent: 0, late: 0, excused: 0, total: list.length };
    for (const a of list) {
        const st = a && a.status;
        if (st === 'present') stats.present++;
        else if (st === 'absent') stats.absent++;
        else if (st === 'late') stats.late++;
        else if (st === 'excused') stats.excused++;
    }
    return stats;
}

function parentViewPayload(token) {
    const st = findStudentByParentToken(token);
    if (!st) return { ok: false, error: 'Ссылка недействительна' };
    const j = getJournalData();
    const group = (j.groups || []).find(g => g.id === st.groupId) || null;
    const records = (j.records || [])
        .filter(r => r && r.studentId === st.id)
        .slice()
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const attendance = (j.attendance || [])
        .filter(a => a && a.studentId === st.id)
        .slice()
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    let user = null;
    if (st.userId) user = findUser(st.userId);
    if (!user && st.name) user = findUserByName(st.name) || null;
    const avgPercent = records.length
        ? Math.round(records.reduce((s, r) => s + (Number(r.percent) || 0), 0) / records.length)
        : null;
    return {
        ok: true,
        student: { name: st.name, groupName: group ? group.name : 'Без группы' },
        balance: user ? Number(user.balance) || 0 : null,
        attendance: attendance.map(a => ({ date: a.date, status: a.status, note: a.note || '' })),
        attendanceStats: studentAttendanceStats(attendance),
        records: records.map(r => ({
            date: r.date,
            subject: r.subject || '',
            percent: r.percent,
            letter: r.letter,
            traditional: r.traditional,
            points: r.points,
            bonus: r.bonus || 0,
            note: r.note || ''
        })),
        avgPercent
    };
}

// Зачисляет деньги за оценки на счета учеников.
// awards[key] = сколько уже начислено за запись (studentId|date|subject).
// Новая оценка — полное начисление, изменение — только разница. Без двойных зачислений.
function syncJournalAwards() {
    const j = getJournalData();
    const awarded = [];
    for (const rec of j.records) {
        const key = rec.studentId + '|' + rec.date + '|' + rec.subject;
        const already = Number(j.awards[key]) || 0;
        const target = Number(rec.points) || 0;
        const delta = target - already;
        if (!delta) continue;
        const st = (j.students || []).find(s => s.id === rec.studentId);
        if (!st) continue;
        let user = null;
        if (st.userId) user = findUser(st.userId);
        if (!user && st.name) {
            user = db.users.find(u => u.name === st.name) || null;
            if (user && !st.userId) st.userId = user.id;
        }
        if (!user) continue;
        const oldBal = user.balance;
        user.balance += delta;
        touchUser(user);
        j.awards[key] = target;
        const tx = {
            id: genId(),
            type: 'journal_reward',
            userId: user.id,
            userName: user.name,
            amount: delta,
            timestamp: Date.now(),
            description: '📖 Оценка за занятие: ' + rec.percent + '%' +
                (rec.subject ? ' · ' + rec.subject : '') +
                (rec.date ? ' · ' + rec.date : ''),
            oldBalance: oldBal,
            newBalance: user.balance
        };
        db.history.push(tx);
        try { emitToUser(user.id, 'transaction:new', tx); } catch (e) { }
        awarded.push({ userId: user.id, name: user.name, points: delta });
    }
    return awarded;
}

// Стартовая сверка: добивает баллы за уже сохранённые оценки
function backfillJournalAwards() {
    try {
        const awarded = syncJournalAwards();
        if (awarded.length) {
            saveDB();
            for (const a of awarded) {
                console.log('[journal] credited', a.points, '→', a.name, '(', a.userId, ')');
            }
        }
        return awarded;
    } catch (e) {
        console.error('[journal] backfill error', e);
        return [];
    }
}

// ==================== MAFIA MODULE (shared helpers) ====================
function mafiaEnsure() {
    if (!db.mafia || typeof db.mafia !== 'object') db.mafia = getDefaultMafia();
    // Drop orphaned participants that no longer exist as users
    let dirty = false;
    if (Array.isArray(db.mafia.joined)) {
        const before = db.mafia.joined.length;
        db.mafia.joined = db.mafia.joined.filter(p => p && findUser(p.userId));
        if (db.mafia.joined.length !== before) dirty = true;
    }
    if (db.mafia.game && Array.isArray(db.mafia.game.players)) {
        const before = db.mafia.game.players.length;
        db.mafia.game.players = db.mafia.game.players.filter(p => p && findUser(p.userId));
        if (db.mafia.game.players.length !== before) {
            if (db.mafia.game.hostId && !db.mafia.game.players.some(p => p.userId === db.mafia.game.hostId)) {
                db.mafia.game.hostId = db.mafia.game.players.length ? db.mafia.game.players[0].userId : null;
            }
            if (!db.mafia.game.players.length) {
                db.mafia.game = null;
                db.mafia.status = 'lobby';
                db.mafia.lobbyOpen = true;
            }
            dirty = true;
        }
    }
    if (dirty) {
        db.mafia.version = (db.mafia.version || 0) + 1;
        saveDB();
    }
    return db.mafia;
}
function mafiaUserBrief(userId) {
    const u = findUser(userId);
    const online = getUserSockets(userId).size > 0;
    return {
        userId,
        name: u ? (u.nickname || u.name) : 'Игрок',
        photo: u && u.profilePhoto ? u.profilePhoto : null,
        online
    };
}
function mafiaTimerPublic(timer) {
    if (!timer) return { duration: 90, left: 90, running: false, endAt: 0 };
    const t = { duration: timer.duration, left: timer.left, running: !!timer.running, endAt: timer.endAt || 0 };
    if (t.running) {
        const left = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
        t.left = left;
        if (left <= 0) {
            t.running = false;
            t.left = 0;
        }
    }
    return t;
}
function mafiaMaybeFinishTimer() {
    const m = mafiaEnsure();
    const t = m.game && m.game.timer;
    if (!t || !t.running) return false;
    const left = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
    if (left > 0) return false;
    t.running = false;
    t.left = 0;
    t.endAt = 0;
    return true;
}
function mafiaForceLobby(reason) {
    const m = mafiaEnsure();
    m.status = 'lobby';
    m.lobbyOpen = true;
    m.game = null;
    mafiaTouchVersion();
    emitMafiaState();
    if (reason) {
        for (const sid of adminSockets) {
            io.to(sid).emit('mafia:error', { message: reason });
        }
    }
}
function mafiaPublicPayload(forSocketId) {
    const m = mafiaEnsure();
    const uid = socketUserMap.get(forSocketId) || null;
    const adm = isAdmin(forSocketId);
    const game = m.game ? {
        players: m.game.players.map(p => ({
            userId: p.userId,
            name: p.name,
            photo: p.photo || null,
            out: !!p.out,
            online: getUserSockets(p.userId).size > 0
        })),
        hostId: m.game.hostId,
        hostName: (m.game.players.find(p => p.userId === m.game.hostId) || {}).name || null,
        hostMode: m.game.hostMode || m.config.hostMode || 'both',
        timer: mafiaTimerPublic(m.game.timer),
        startedAt: m.game.startedAt || 0
    } : null;
    const me = uid ? {
        userId: uid,
        isAdmin: adm,
        inLobby: m.joined.some(p => p.userId === uid),
        isPlayer: !!(m.game && m.game.players.some(p => p.userId === uid)),
        isHost: !!(m.game && m.game.hostId === uid),
        myRole: null,
        myOut: false
    } : { userId: null, isAdmin: adm, inLobby: false, isPlayer: false, isHost: false, myRole: null, myOut: false };
    if (uid && m.game) {
        const mp = m.game.players.find(p => p.userId === uid);
        if (mp) {
            me.myRole = mp.role;
            me.myOut = !!mp.out;
        }
    }
    return {
        status: m.status,
        lobbyOpen: !!m.lobbyOpen,
        joined: m.joined.map(p => ({ userId: p.userId, name: p.name, photo: p.photo || null, joinedAt: p.joinedAt || 0, online: getUserSockets(p.userId).size > 0 })),
        game,
        config: adm ? m.config : undefined,
        canManage: adm,
        canFinish: adm || !!(m.game && m.game.hostId === uid && m.config.allowHostFinish),
        version: m.version,
        me
    };
}
function emitMafiaState() {
    mafiaEnsure();
    const seen = new Set();
    for (const socketId of socketUserMap.keys()) {
        seen.add(socketId);
        io.to(socketId).emit('mafia:state', mafiaPublicPayload(socketId));
    }
    for (const sid of adminSockets) {
        if (!seen.has(sid)) io.to(sid).emit('mafia:state', mafiaPublicPayload(sid));
    }
}
function mafiaSendMyRole(userId) {
    const m = mafiaEnsure();
    if (!m.game) return;
    const p = m.game.players.find(x => x.userId === userId);
    if (!p) return;
    emitToUser(userId, 'mafia:myRole', { role: p.role, out: !!p.out, hostId: m.game.hostId, name: p.name });
}
function mafiaTouchVersion() {
    const m = mafiaEnsure();
    m.version = (m.version || 0) + 1;
    saveDB();
}
function mafiaBroadcastTimerEnd() {
    const payload = { at: Date.now() };
    for (const socketId of socketUserMap.keys()) io.to(socketId).emit('mafia:timerEnd', payload);
    for (const sid of adminSockets) io.to(sid).emit('mafia:timerEnd', payload);
}
// Single watchdog: finalize discussion timer and notify all clients
setInterval(() => {
    try {
        if (mafiaMaybeFinishTimer()) {
            mafiaTouchVersion();
            emitMafiaState();
            mafiaBroadcastTimerEnd();
            // Time is up — close the deal and return everyone to the waiting room
            const m = mafiaEnsure();
            if (m.status === 'playing') {
                mafiaForceLobby('Время обсуждения вышло — партия завершена.');
            }
        }
    } catch (e) { /* timer watchdog must never crash the server */ }
}, 500);

// Guest session / QR expiry watchdog (1 hour TTL)
setInterval(() => {
    try {
        cleanupExpiredGuests();
    } catch (e) { /* guest cleanup must never crash the server */ }
}, 30000);

// ==================== PARTY GAMES (Крокодил / Бункер) ====================
const PARTY_DECKS = require('./party-decks.json');

function partyDefaultGame(mode) {
    const deck = Array.isArray(PARTY_DECKS[mode]) ? PARTY_DECKS[mode].slice() : [];
    return {
        mode,
        status: 'idle',
        lobbyOpen: false,
        config: { allowNext: true, distribution: 'all' },
        deck,
        pool: [],
        used: [],
        players: [],
        version: 0
    };
}

function partyEnsure() {
    if (!db.party || typeof db.party !== 'object') db.party = {};
    for (const mode of ['croc', 'bunker']) {
        if (!db.party[mode] || typeof db.party[mode] !== 'object') {
            db.party[mode] = partyDefaultGame(mode);
            continue;
        }
        const g = db.party[mode];
        if (!Array.isArray(g.deck) || !g.deck.length) g.deck = (PARTY_DECKS[mode] || []).slice();
        if (!Array.isArray(g.pool)) g.pool = [];
        if (!Array.isArray(g.used)) g.used = [];
        if (!Array.isArray(g.players)) g.players = [];
        if (!g.config || typeof g.config !== 'object') g.config = { allowNext: true, distribution: 'all' };
        if (g.config.allowNext === undefined) g.config.allowNext = true;
        if (g.config.distribution !== 'turn') g.config.distribution = 'all';
        const before = g.players.length;
        g.players = g.players.filter(p => p && findUser(p.userId));
        if (g.players.length !== before) {
            g.version = (g.version || 0) + 1;
            saveDB();
        }
    }
    return db.party;
}

function partyGet(mode) {
    partyEnsure();
    if (mode !== 'croc' && mode !== 'bunker') return null;
    return db.party[mode];
}

function partyShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function partyTouch(mode) {
    const g = partyGet(mode);
    if (g) g.version = (g.version || 0) + 1;
}

function partyUserBrief(userId) {
    const u = findUser(userId);
    return {
        userId,
        name: u ? (u.nickname || u.name) : 'Игрок',
        photo: u && u.profilePhoto ? u.profilePhoto : null,
        online: getUserSockets(userId).size > 0
    };
}

function partyPublicPayload(mode, forSocketId) {
    const g = partyGet(mode);
    if (!g) return null;
    const uid = socketUserMap.get(forSocketId) || null;
    const adm = isAdmin(forSocketId);
    const players = g.players.map(p => ({
        userId: p.userId,
        name: p.name,
        photo: p.photo || null,
        hasCard: !!p.card,
        online: getUserSockets(p.userId).size > 0,
        joinedAt: p.joinedAt || 0
    }));
    const me = uid ? {
        userId: uid,
        isAdmin: adm,
        inRoom: g.players.some(p => p.userId === uid),
        hasCard: !!(g.players.find(p => p.userId === uid) || {}).card,
        myCard: null
    } : { userId: null, isAdmin: adm, inRoom: false, hasCard: false, myCard: null };
    return {
        mode: g.mode,
        status: g.status,
        lobbyOpen: !!g.lobbyOpen,
        config: { allowNext: !!g.config.allowNext, distribution: g.config.distribution },
        players,
        poolCount: g.pool.length,
        usedCount: g.used.length,
        deckCount: g.deck.length,
        canManage: adm,
        me,
        version: g.version || 0
    };
}

function partySendMyCard(mode, userId) {
    const g = partyGet(mode);
    if (!g || !userId) return;
    const p = g.players.find(x => x.userId === userId);
    if (!p) return;
    emitToUser(userId, 'party:myCard', {
        mode: g.mode,
        card: p.card || null,
        hasCard: !!p.card,
        allowNext: !!(g.config.allowNext && g.status === 'playing'),
        phase: g.status
    });
}

function partyEmitState(mode) {
    const g = partyGet(mode);
    if (!g) return;
    const seen = new Set();
    for (const socketId of socketUserMap.keys()) {
        seen.add(socketId);
        io.to(socketId).emit('party:state', partyPublicPayload(mode, socketId));
    }
    for (const sid of adminSockets) {
        if (!seen.has(sid)) io.to(sid).emit('party:state', partyPublicPayload(mode, sid));
    }
    for (const p of g.players) partySendMyCard(mode, p.userId);
}

function partyDraw(mode) {
    const g = partyGet(mode);
    if (!g) throw new Error('Игра не найдена.');
    if (!g.pool.length) throw new Error('Все персонажи использованы. Перемешайте колоду.');
    const card = g.pool.pop();
    g.used.push(card);
    return card;
}

function partyDealTo(mode, userId) {
    const g = partyGet(mode);
    const p = g.players.find(x => x.userId === userId);
    if (!p) throw new Error('Участник не найден.');
    if (p.card) return p.card;
    p.card = partyDraw(mode);
    return p.card;
}

// --- Socket.io ---

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Flood protection: limit events per socket window
    const _flood = { start: Date.now(), count: 0, warned: false };
    const _floodExempt = new Set(['mafia:finish', 'mafia:reset', 'admin:login', 'admin:resume', 'user:login_password', 'user:login_with_pin']);
    socket.use((packet, next) => {
        const now = Date.now();
        if (now - _flood.start > 10000) {
            _flood.start = now;
            _flood.count = 0;
            _flood.warned = false;
        }
        _flood.count++;
        const evName = packet && packet[0];
        if (_flood.count > 120 && !_floodExempt.has(evName)) {
            if (!_flood.warned) {
                _flood.warned = true;
                logSecurityEvent('socket_flood', socket.id, 'Превышен лимит событий socket.io');
                notifyAdminsThreat('🌊 Флуд-запросы', 'Socket ' + String(socket.id).slice(0, 8) + ': превышен лимит событий');
            }
            return; // drop event
        }
        next();
    });

    // Send initial data (no user-specific data yet)
    socket.emit('init', {
        history: [],
        users: db.users.filter(u => !u.archived).map(u => publicUserLight(u, getOnlineUserIds())),
        messages: [],
        onlineCount: getOnlineCount(),
        notifications: [],
        me: null
    });

    // --- Check if user has PIN ---
    socket.on('user:check_pin', (data) => {
        const name = sanitizeName(data?.name);
        if (!name) { socket.emit('error', { message: 'Введите имя.' }); return; }
        const user = findUserByName(name);
        if (!user) {
            socket.emit('user:pin_status', { exists: false, name, userId: null });
            return;
        }
        socket.emit('user:pin_status', { exists: true, hasPin: !!user.pinHash, hasPassword: !!user.passwordHash, name, userId: user.id });
    });

    // --- Set PIN (first time) — only for accounts created without credentials ---
    socket.on('user:set_pin', (data) => {
        const userId = data?.userId;
        const pin = String(data?.pin || '');
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        // Security: never allow setting PIN if account already has password or PIN
        if (user.passwordHash || user.pinHash) {
            socket.emit('error', { message: 'Учётная запись уже защищена. Обратитесь к администратору.' });
            return;
        }
        const blockP = isUserBlocked(user.id);
        if (blockP) { socket.emit('user:blocked_login', { mode: blockP.mode, reason: blockP.mode === 'standard' ? blockP.reason : null, expiresAt: blockP.expiresAt }); return; }
        if (!/^\d{4}$/.test(pin)) { socket.emit('error', { message: 'PIN должен состоять ровно из 4 цифр.' }); return; }
        const { hash, salt } = hashPin(pin);
        user.pinHash = hash;
        user.salt = salt;
        touchUser(user); markUserSeen(user.id);
        saveDB();
        addSocketUser(socket.id, user.id);
        const session = createSession(user.id);
        const onlineIds = getOnlineUserIds();
        const uxData = getXP(user.id);
        socket.emit('user:logged_in', {
            user: publicUserFull(user, onlineIds),
            favorites: db.favorites[user.id] || [],
            history: db.history.filter(t => t.userId === user.id || t.toId === user.id || t.fromId === user.id),
            messages: db.messages.filter(m => m.fromId === user.id || m.toId === user.id),
            notifications: db.notifications.filter(n => n.targetUserId === user.id),
            xp: uxData,
            sessionToken: session.token
        });
        emitBankUpdate();
    });

    // --- Login with PIN ---
    socket.on('user:login_with_pin', (data) => {
        if (isMaintenanceEnabled()) {
            socket.emit('maintenance:blocked', { message: 'Ведутся технические работы. Пожалуйста, зайдите позже.' });
            return;
        }
        const userId = data?.userId;
        const pin = String(data?.pin || '');
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.', code: 'USER_NOT_FOUND' }); return; }
        if (!user.pinHash) { socket.emit('error', { message: 'PIN не установлен.' }); return; }
        if (!/^\d{4}$/.test(pin)) { socket.emit('error', { message: 'PIN должен состоять из 4 цифр.' }); return; }
        const rlKey = clientKey(socket, user.id);
        const lockedMs = loginLockRemaining(rlKey);
        if (lockedMs > 0) {
            socket.emit('error', { message: 'Слишком много попыток. Повторите через ' + Math.ceil(lockedMs / 60000) + ' мин.' });
            return;
        }
        try {
            if (!verifyPin(pin, user.pinHash, user.salt)) {
                registerLoginFail(rlKey, user.name);
                logSecurityEvent('failed_login_pin', user.name, 'Неверный PIN');
                socket.emit('error', { message: 'Неверный PIN-код.' });
                return;
            }
        } catch {
            socket.emit('error', { message: 'Ошибка проверки PIN.' });
            return;
        }
        clearLoginFails(rlKey);
        const block2 = isUserBlocked(user.id);
        if (block2) { socket.emit('user:blocked_login', { mode: block2.mode, reason: block2.mode === 'standard' ? block2.reason : null, expiresAt: block2.expiresAt }); return; }
        touchUser(user); markUserSeen(user.id);
        saveDB();
        addSocketUser(socket.id, user.id);
        const session = createSession(user.id);
        const onlineIds = getOnlineUserIds();
        const uxData2 = getXP(user.id);
        socket.emit('user:logged_in', {
            user: publicUserFull(user, onlineIds),
            favorites: db.favorites[user.id] || [],
            history: db.history.filter(t => t.userId === user.id || t.toId === user.id || t.fromId === user.id),
            messages: db.messages.filter(m => m.fromId === user.id || m.toId === user.id),
            notifications: db.notifications.filter(n => n.targetUserId === user.id),
            xp: uxData2,
            sessionToken: session.token
        });
        emitBankUpdate();
    });

    // --- Login with password (primary) ---
    socket.on('user:login_password', (data) => {
        if (isMaintenanceEnabled()) {
            socket.emit('user:login_result', { success: false, maintenance: true, message: 'Ведутся технические работы. Пожалуйста, зайдите позже.' });
            return;
        }
        const name = sanitizeName(data?.name);
        const password = String(data?.password || '');
        if (!name || !password) {
            socket.emit('user:login_result', { success: false, message: 'Неверное имя пользователя или пароль' });
            return;
        }
        const user = findUserByName(name);
        const rlKey = clientKey(socket, name || 'unknown');
        const lockedMs = loginLockRemaining(rlKey);
        if (lockedMs > 0) {
            socket.emit('user:login_result', {
                success: false,
                message: 'Слишком много попыток входа. Повторите через ' + Math.ceil(lockedMs / 60000) + ' мин.'
            });
            return;
        }
        if (!user) {
            registerLoginFail(rlKey, name);
            logSecurityEvent('failed_login_password', name, 'Неизвестное имя');
            socket.emit('user:login_result', { success: false, message: 'Неверное имя пользователя или пароль' });
            return;
        }
        if (user.archived) {
            socket.emit('user:login_result', { success: false, message: 'Аккаунт недоступен. Обратитесь к администратору.' });
            return;
        }
        const block = isUserBlocked(user.id);
        if (block) {
            socket.emit('user:login_result', {
                success: false, blocked: true,
                message: block.mode === 'standard' && block.reason
                    ? 'Аккаунт заблокирован: ' + block.reason
                    : 'Аккаунт заблокирован. Обратитесь к администратору.'
            });
            return;
        }
        if (!user.passwordHash) {
            // Legacy account with PIN — allow PIN login as fallback
            if (user.pinHash) {
                socket.emit('user:login_result', {
                    success: false,
                    needPin: true,
                    userId: user.id,
                    name: user.name,
                    message: 'Введите PIN-код'
                });
                return;
            }
            socket.emit('user:login_result', {
                success: false,
                message: 'Для входа нужен пароль. Обратитесь к администратору для получения данных доступа.'
            });
            return;
        }
        let valid = false;
        try { valid = verifyPassword(password, user.passwordHash, user.passwordSalt || user.salt); } catch { valid = false; }
        if (!valid) {
            registerLoginFail(rlKey, user.name);
            logSecurityEvent('failed_login_password', user.name, 'Неверный пароль');
            socket.emit('user:login_result', { success: false, message: 'Неверное имя пользователя или пароль' });
            return;
        }
        clearLoginFails(rlKey);
        appendAudit({ actorId: user.id, actorName: user.name, actorRole: 'student', action: 'login_success', target: user.name, result: 'success', source: 'socket' });
        touchUser(user); markUserSeen(user.id);
        saveDB();
        addSocketUser(socket.id, user.id);
        checkMaturedDeposits(user.id);
        const session = createSession(user.id);
        const onlineIds = getOnlineUserIds();
        const uxData = getXP(user.id);
        socket.emit('user:logged_in', {
            user: publicUserFull(user, onlineIds),
            favorites: db.favorites[user.id] || [],
            history: db.history.filter(t => t.userId === user.id || t.toId === user.id || t.fromId === user.id),
            messages: db.messages.filter(m => m.fromId === user.id || m.toId === user.id),
            notifications: db.notifications.filter(n => n.targetUserId === user.id),
            xp: uxData,
            sessionToken: session.token
        });
        socket.emit('user:login_result', { success: true, name: user.name });
        emitBankUpdate();
    });

    // --- Self-registration DISABLED: only admin creates accounts ---
    socket.on('user:register', (data) => {
        socket.emit('user:register_disabled', {
            message: 'У вас ещё нет аккаунта. Пожалуйста, обратитесь к администратору для получения данных доступа.'
        });
    });

    // --- Account access request (from «Нет аккаунта?») ---
    socket.on('account:request', (data) => {
        const name = sanitizeName(data?.name) || '';
        const comment = String(data?.comment || '').trim().slice(0, 300);
        if (name.length > 20) {
            socket.emit('account:request_result', { success: false, message: 'Имя слишком длинное (макс. 20 символов).' });
            return;
        }
        // Avoid duplicate spam within 2 minutes for same name/ip
        const now = Date.now();
        const key = (name || 'anon') + '|' + (socket.handshake && socket.handshake.address || '');
        if (!db.accountRequests) db.accountRequests = [];
        const recent = db.accountRequests.find(r => r._key === key && now - r.timestamp < 120000);
        if (recent) {
            socket.emit('account:request_result', {
                success: true,
                message: 'Запрос уже отправлен. Ожидайте ответа администратора.',
                requestId: recent.id
            });
            return;
        }
        const req = {
            id: genId(),
            name: name || null,
            comment,
            timestamp: now,
            status: 'new', // 'new' | 'read'
            _key: key
        };
        db.accountRequests.push(req);
        saveDB();
        // Notify all admin sockets
        for (const sid of adminSockets) {
            io.to(sid).emit('admin:accountRequest', {
                id: req.id,
                name: req.name,
                comment: req.comment,
                timestamp: req.timestamp,
                status: req.status
            });
        }
        socket.emit('account:request_result', {
            success: true,
            message: 'Запрос отправлен администратору. Ожидайте получения доступа.',
            requestId: req.id
        });
    });

    // --- Legacy login (by userId from localStorage) — requires PIN/password verification ---
    socket.on('user:login', (data) => {
        const user = findUser(data?.userId);
        if (!user) {
            socket.emit('error', { message: 'Пользователь не найден.', code: 'USER_NOT_FOUND' });
            return;
        }
        const blockL = isUserBlocked(user.id);
        if (blockL) { socket.emit('user:blocked_login', { mode: blockL.mode, reason: blockL.mode === 'standard' ? blockL.reason : null, expiresAt: blockL.expiresAt }); return; }
        // Never auto-login without verification when credentials are set
        if (user.passwordHash || user.pinHash) {
            if (user.passwordHash) {
                socket.emit('user:login_result', { success: false, message: 'Введите имя пользователя и пароль.' });
            } else {
                socket.emit('user:pin_status', { exists: true, hasPin: true, name: user.name, userId: user.id });
            }
            return;
        }
        // Account without credentials (admin-created, awaiting setup)
        addSocketUser(socket.id, user.id);
        touchUser(user); markUserSeen(user.id); saveDB();
        checkMaturedDeposits(user.id);
        const session = createSession(user.id);
        const onlineIds = getOnlineUserIds();
        const uxData3 = getXP(user.id);
        socket.emit('user:logged_in', {
            user: publicUserFull(user, onlineIds),
            favorites: db.favorites[user.id] || [],
            history: db.history.filter(t => t.userId === user.id || t.toId === user.id || t.fromId === user.id),
            messages: db.messages.filter(m => m.fromId === user.id || m.toId === user.id),
            notifications: db.notifications.filter(n => n.targetUserId === user.id),
            xp: uxData3,
            sessionToken: session.token
        });
        emitBankUpdate();
    });

    // --- Session Login (fast re-entry, no PIN needed) ---
    socket.on('user:session_login', (data) => {
        cleanupExpiredGuests();
        const token = data?.token;
        const session = validateSession(token);
        if (!session) {
            socket.emit('session:invalid', {});
            return;
        }
        const user = findUser(session.userId);
        if (!user) {
            removeSession(token);
            socket.emit('session:invalid', {});
            return;
        }
        // Guest sessions: enforce 1h expiry on every entry
        if (user.isGuest) {
            const gs = findGuestSessionByToken(token);
            if (!gs) {
                removeSession(token);
                socket.emit('session:invalid', { reason: 'guest_expired' });
                return;
            }
            user.guestExpiresAt = gs.expiresAt;
        }
        // Maintenance: block regular users (admin panel access is separate)
        if (isMaintenanceEnabled() && !user.isGuest) {
            // allow admin sockets only; regular users get maintenance screen
            socket.emit('maintenance:blocked', { message: 'Ведутся технические работы. Пожалуйста, зайдите позже.' });
            return;
        }
        if (isMaintenanceEnabled() && user.isGuest) {
            socket.emit('maintenance:blocked', { message: 'Ведутся технические работы. Пожалуйста, зайдите позже.' });
            return;
        }
        const blockS = isUserBlocked(user.id);
        if (blockS) { socket.emit('user:blocked_login', { mode: blockS.mode, reason: blockS.mode === 'standard' ? blockS.reason : null, expiresAt: blockS.expiresAt }); return; }
        addSocketUser(socket.id, user.id);
        touchUser(user); markUserSeen(user.id); saveDB();
        checkMaturedDeposits(user.id);
        const onlineIds = getOnlineUserIds();
        const uxData = getXP(user.id);
        socket.emit('user:logged_in', {
            user: publicUserFull(user, onlineIds),
            favorites: db.favorites[user.id] || [],
            history: db.history.filter(t => t.userId === user.id || t.toId === user.id || t.fromId === user.id),
            messages: db.messages.filter(m => m.fromId === user.id || m.toId === user.id),
            notifications: db.notifications.filter(n => n.targetUserId === user.id),
            xp: uxData,
            sessionToken: session.token
        });
        emitBankUpdate();
    });

    // --- Logout (current device only) ---
    socket.on('user:logout', (data) => {
        const token = data?.token || null;
        const uid = socketUserMap.get(socket.id);
        if (token) {
            const sess = db.sessions.find(s => s.token === token);
            if (sess && uid && sess.userId === uid) {
                db.sessions = db.sessions.filter(s => s.token !== token);
            }
        } else if (uid) {
            // no token → drop this socket's association only
        }
        if (uid) {
            // remove this socket mapping so the device is logged out
            socketUserMap.delete(socket.id);
        }
        saveDB();
        socket.emit('user:logged_out', { success: true });
    });

    // --- Guest mode toggle (admin) ---
    socket.on('admin:guestMode:set', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('guestMode:setResult', { success: false, error: 'Доступ запрещён' }); return; }
        ensureGuestState();
        db.guestMode.enabled = !!data?.enabled;
        db.guestMode.updatedAt = Date.now();
        saveDB();
        socket.emit('guestMode:setResult', { success: true, guestMode: db.guestMode });
        emitGuestModeState();
    });

    socket.on('guestMode:get', () => {
        ensureGuestState();
        socket.emit('guestMode:state', { enabled: !!db.guestMode.enabled, updatedAt: db.guestMode.updatedAt || null });
    });

    // --- Maintenance mode toggle (admin) ---
    socket.on('admin:forceUpdate', () => {
        if (!isAdmin(socket.id)) return;
        for (const socketId of socketUserMap.keys()) {
            io.to(socketId).emit('app:forceUpdate');
        }
        for (const sid of adminSockets) {
            io.to(sid).emit('app:forceUpdate');
        }
        logAdminAction('force_update', null, null, null, null, 'Принудительное обновление для всех пользователей');
    });

    socket.on('admin:maintenance:set', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('maintenance:setResult', { success: false, error: 'Доступ запрещён' }); return; }
        ensureGuestState();
        db.maintenanceMode.enabled = !!data?.enabled;
        db.maintenanceMode.updatedAt = Date.now();
        saveDB();
        socket.emit('maintenance:setResult', { success: true, maintenanceMode: db.maintenanceMode });
        emitMaintenanceState();
        // Force non-admin users to the maintenance screen immediately
        if (db.maintenanceMode.enabled) {
            for (const socketId of socketUserMap.keys()) {
                if (!adminSockets.has(socketId)) {
                    io.to(socketId).emit('maintenance:blocked', { message: 'Ведутся технические работы. Пожалуйста, зайдите позже.' });
                }
            }
        }
    });

    socket.on('maintenance:get', () => {
        ensureGuestState();
        socket.emit('maintenance:state', { enabled: !!db.maintenanceMode.enabled, updatedAt: db.maintenanceMode.updatedAt || null });
    });

    // --- Guest login by name (only when guest mode is ON) ---
    socket.on('user:guest_login', (data) => {
        cleanupExpiredGuests();
        ensureGuestState();
        if (isMaintenanceEnabled()) {
            socket.emit('user:guest_login_result', maintenanceBlocked());
            return;
        }
        if (!isGuestModeEnabled()) {
            socket.emit('user:guest_login_result', { success: false, message: 'Гостевой режим выключен. Обратитесь к администратору.' });
            return;
        }
        const name = sanitizeName(data?.name);
        if (!name || name.length < 2 || name.length > 20) {
            socket.emit('user:guest_login_result', { success: false, message: 'Введите имя (2–20 символов).' });
            return;
        }
        // Temporary guest account, distinct from registered users
        const guestId = genId();
        const guestName = name;
        const now = Date.now();
        const user = {
            id: guestId,
            name: guestName,
            balance: 0,
            createdAt: now,
            lastActive: now,
            isGuest: true,
            guestExpiresAt: now + GUEST_SESSION_TTL_MS,
            passwordHash: null,
            pinHash: null,
            salt: null
        };
        db.users.push(user);
        const session = createSession(guestId);
        createGuestSession(guestId, session.token);
        addSocketUser(socket.id, guestId);
        saveDB();
        socket.emit('user:guest_login_result', {
            success: true,
            user: publicUserFull(user, getOnlineUserIds()),
            sessionToken: session.token,
            expiresAt: user.guestExpiresAt
        });
        socket.emit('user:logged_in', {
            user: publicUserFull(user, getOnlineUserIds()),
            favorites: [],
            history: [],
            messages: [],
            notifications: [],
            xp: { xp: 0, level: 1 },
            sessionToken: session.token
        });
    });

    // --- Guest QR: create one-time token (admin) ---
    socket.on('admin:guestQr:create', () => {
        if (!isAdmin(socket.id)) { socket.emit('admin:guestQr:created', { success: false, error: 'Доступ запрещён' }); return; }
        cleanupExpiredGuests();
        ensureGuestState();
        const token = crypto.randomBytes(24).toString('hex');
        const now = Date.now();
        const qr = {
            id: genId(),
            token,
            createdAt: now,
            expiresAt: now + GUEST_SESSION_TTL_MS,
            used: false,
            usedBy: null
        };
        db.guestQrTokens.push(qr);
        saveDB();
        socket.emit('admin:guestQr:created', {
            success: true,
            qr: { id: qr.id, token: qr.token, createdAt: qr.createdAt, expiresAt: qr.expiresAt, used: false }
        });
    });

    socket.on('admin:guestQr:list', () => {
        if (!isAdmin(socket.id)) { socket.emit('admin:guestQr:list', { success: false, error: 'Доступ запрещён' }); return; }
        cleanupExpiredGuests();
        ensureGuestState();
        socket.emit('admin:guestQr:list', {
            success: true,
            tokens: db.guestQrTokens.map(t => ({
                id: t.id, token: t.token, createdAt: t.createdAt,
                expiresAt: t.expiresAt, used: !!t.used, usedBy: t.usedBy || null
            }))
        });
    });

    socket.on('admin:guestQr:revoke', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('admin:guestQr:revoked', { success: false, error: 'Доступ запрещён' }); return; }
        ensureGuestState();
        db.guestQrTokens = db.guestQrTokens.filter(t => t.id !== data?.id);
        saveDB();
        socket.emit('admin:guestQr:revoked', { success: true, id: data?.id });
    });

    // --- Guest login by QR (one-time, 1h) ---
    socket.on('user:guestQr_login', (data) => {
        cleanupExpiredGuests();
        ensureGuestState();
        if (isMaintenanceEnabled()) {
            socket.emit('user:guest_login_result', maintenanceBlocked());
            return;
        }
        const raw = String(data?.token || data?.qrToken || '').trim();
        if (!raw) {
            socket.emit('user:guest_login_result', { success: false, message: 'Неверный QR-код.' });
            return;
        }
        // Accept both raw token and JSON payload {type:'mandarin_guest_qr', token}
        let token = raw;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.token) token = String(parsed.token);
            if (parsed && parsed.type && parsed.type !== 'mandarin_guest_qr' && !parsed.token) {
                socket.emit('user:guest_login_result', { success: false, message: 'Этот QR-код не для гостевого входа.' });
                return;
            }
        } catch (e) { /* plain token */ }
        const qr = db.guestQrTokens.find(t => t.token === token);
        if (!qr) {
            socket.emit('user:guest_login_result', { success: false, message: 'QR-код не найден или уже использован.' });
            return;
        }
        if (qr.used) {
            socket.emit('user:guest_login_result', { success: false, message: 'QR-код уже использован. Повторный вход невозможен.' });
            return;
        }
        if (qr.expiresAt <= Date.now()) {
            socket.emit('user:guest_login_result', { success: false, message: 'Срок действия QR-кода истёк.' });
            return;
        }
        // One-time use
        qr.used = true;
        qr.usedBy = { at: Date.now(), ip: (socket.handshake && socket.handshake.address) || null };
        ensureGuestState();
        db.guestCounter = (db.guestCounter || 0) + 1;
        const guestName = 'Пользователь ' + db.guestCounter;
        const now = Date.now();
        const user = {
            id: genId(),
            name: guestName,
            balance: 0,
            createdAt: now,
            lastActive: now,
            isGuest: true,
            guestExpiresAt: now + GUEST_SESSION_TTL_MS,
            passwordHash: null,
            pinHash: null,
            salt: null
        };
        db.users.push(user);
        const session = createSession(user.id);
        createGuestSession(user.id, session.token);
        addSocketUser(socket.id, user.id);
        saveDB();
        socket.emit('user:guest_login_result', {
            success: true,
            user: publicUserFull(user, getOnlineUserIds()),
            sessionToken: session.token,
            expiresAt: user.guestExpiresAt
        });
        socket.emit('user:logged_in', {
            user: publicUserFull(user, getOnlineUserIds()),
            favorites: [],
            history: [],
            messages: [],
            notifications: [],
            xp: { xp: 0, level: 1 },
            sessionToken: session.token
        });
    });

    // --- Admin Login ---
    socket.on('admin:login', (data) => {
        const pin = String(data?.pin || '');
        if (!/^\d{4,6}$/.test(pin)) {
            socket.emit('error', { message: 'Неверный формат PIN.' });
            return;
        }
        const adminRlKey = clientKey(socket, 'admin');
        const adminLockedMs = loginLockRemaining(adminRlKey);
        if (adminLockedMs > 0) {
            socket.emit('error', { message: 'Слишком много попыток входа администратора. Повторите через ' + Math.ceil(adminLockedMs / 60000) + ' мин.' });
            return;
        }
        // If admin PIN not set yet, set it
        if (!db.adminPinHash) {
            const { hash, salt } = hashPin(pin);
            db.adminPinHash = hash;
            db.adminSalt = salt;
            saveDB();
            adminSockets.add(socket.id);
            const adminToken = createAdminSessionToken();
            socket.emit('admin:authenticated', { success: true, firstTime: true, adminToken, expiresAt: Date.now() + ADMIN_SESSION_TTL });
            logAdminAction('admin_login', null, null, null, null, 'Первый вход, PIN установлен');
            saveDB();
            return;
        }
        try {
            if (!verifyPin(pin, db.adminPinHash, db.adminSalt)) {
                registerLoginFail(adminRlKey, 'admin');
                logSecurityEvent('failed_login_admin', 'admin', 'Неверный PIN администратора');
                notifyAdminsThreat('⚠️ Подозрительный вход', 'Неудачная попытка входа в админ-панель');
                socket.emit('error', { message: 'Неверный PIN администратора.' });
                return;
            }
        } catch {
            socket.emit('error', { message: 'Ошибка проверки PIN.' });
            return;
        }
        clearLoginFails(adminRlKey);
        adminSockets.add(socket.id);
        const adminToken = createAdminSessionToken();
        socket.emit('admin:authenticated', { success: true, firstTime: false, adminToken, expiresAt: Date.now() + ADMIN_SESSION_TTL });
        // Send full admin data
        const onlineIds = getOnlineUserIds();
        socket.emit('admin:full_data', {
            users: db.users.map(u => publicUserAdmin(u, onlineIds)),
            history: db.history,
            adminHistory: db.adminHistory,
            onlineCount: getOnlineCount(),
            groups: getAllGroups(),
            groupPermissions: db.groupPermissions,
            coupons: db.coupons,
            userCoupons: db.userCoupons,
            couponNotifications: db.couponNotifications,
            purchaseRequests: db.purchaseRequests,
            quests: db.quests,
            tasks: db.taskAssignments,
            duels: db.duels,
            userXP: db.userXP,
            approvalRequests: db.approvalRequests
        });
        logAdminAction('admin_login', null, null, null, null, 'Вход в админ-панель');
        saveDB();
    });

    // --- Admin session resume (reconnect without PIN) ---
    socket.on('admin:resume', (data) => {
        const token = String(data?.adminToken || '');
        if (!validateAdminSessionToken(token)) {
            socket.emit('admin:resumeResult', { success: false });
            return;
        }
        adminSockets.add(socket.id);
        socket.emit('admin:resumeResult', { success: true, expiresAt: adminSessions.get(token) });
        const onlineIds = getOnlineUserIds();
        socket.emit('admin:full_data', {
            users: db.users.map(u => publicUserAdmin(u, onlineIds)),
            history: db.history,
            adminHistory: db.adminHistory,
            onlineCount: getOnlineCount(),
            groups: getAllGroups(),
            groupPermissions: db.groupPermissions,
            coupons: db.coupons,
            userCoupons: db.userCoupons,
            couponNotifications: db.couponNotifications,
            purchaseRequests: db.purchaseRequests,
            quests: db.quests,
            tasks: db.taskAssignments,
            duels: db.duels,
            userXP: db.userXP,
            approvalRequests: db.approvalRequests
        });
    });

    // --- Admin Change Password ---
    socket.on('admin:changePassword', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('admin:changePasswordResult', { success: false, message: 'Нет доступа.' }); return; }
        const { currentPin, newPin } = data;
        if (!/^\d{4,6}$/.test(String(currentPin || ''))) { socket.emit('admin:changePasswordResult', { success: false, message: 'Текущий PIN: 4-6 цифр.' }); return; }
        if (!/^\d{4,6}$/.test(String(newPin || ''))) { socket.emit('admin:changePasswordResult', { success: false, message: 'Новый PIN: 4-6 цифр.' }); return; }
        if (!db.adminPinHash) { socket.emit('admin:changePasswordResult', { success: false, message: 'PIN ещё не установлен.' }); return; }
        try {
            if (!verifyPin(String(currentPin), db.adminPinHash, db.adminSalt)) {
                socket.emit('admin:changePasswordResult', { success: false, message: 'Неверный текущий PIN.' });
                return;
            }
        } catch {
            socket.emit('admin:changePasswordResult', { success: false, message: 'Ошибка проверки PIN.' });
            return;
        }
        const { hash, salt } = hashPin(String(newPin));
        db.adminPinHash = hash;
        db.adminSalt = salt;
        saveDB();
        socket.emit('admin:changePasswordResult', { success: true, message: 'PIN успешно изменён!' });
        logAdminAction('change_admin_pin', null, null, null, null, 'Смена PIN администратора');
    });

    // --- Admin Set Profile Color ---
    socket.on('admin:setProfileColor', (data) => {
        if (!isAdmin(socket.id)) return;
        const { userId, color } = data;
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const validColors = ['#38bdf8','#3b82f6','#8b5cf6','#a78bfa','#ec4899','#ef4444','#f97316','#f59e0b','#22c55e','#14b8a6','#64748b','#fb7185'];
        if (color !== null && color !== undefined && color !== '' && !validColors.includes(color)) {
            socket.emit('error', { message: 'Недопустимый цвет.' }); return;
        }
        user.profileColor = (color && color !== '') ? color : null;
        saveDB();
        const onlineIds = getOnlineUserIds();
        const freshUsers = db.users.map(u => publicUserAdmin(u, onlineIds));
        socket.emit('admin:full_data', {
            users: freshUsers,
            history: db.history,
            adminHistory: db.adminHistory,
            onlineCount: getOnlineCount(),
            groups: getAllGroups(),
            groupPermissions: db.groupPermissions,
            coupons: db.coupons,
            userCoupons: db.userCoupons,
            couponNotifications: db.couponNotifications,
            purchaseRequests: db.purchaseRequests,
            quests: db.quests,
            tasks: db.taskAssignments,
            duels: db.duels,
            userXP: db.userXP,
            approvalRequests: db.approvalRequests
        });
        logAdminAction('set_profile_color', userId, null, null, null, color || 'default');
    });

    // --- Admin: Set User Nickname ---
    socket.on('admin:setNickname', (data) => {
        if (!isAdmin(socket.id)) return;
        const { userId, nickname } = data;
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        user.nickname = (nickname && typeof nickname === 'string' && nickname.trim()) ? nickname.trim().substring(0, 30) : null;
        saveDB();
        emitBankUpdate();
        socket.emit('admin:full_data', {
            users: db.users.map(u => publicUserAdmin(u, getOnlineUserIds())),
            history: db.history, adminHistory: db.adminHistory,
            onlineCount: getOnlineCount(), groups: getAllGroups(),
            groupPermissions: db.groupPermissions, coupons: db.coupons,
            userCoupons: db.userCoupons, couponNotifications: db.couponNotifications,
            purchaseRequests: db.purchaseRequests, quests: db.quests,
            tasks: db.taskAssignments, duels: db.duels,
            userXP: db.userXP, approvalRequests: db.approvalRequests
        });
        logAdminAction('set_nickname', userId, user.name, null, null, user.nickname || 'default');
    });

    // --- Admin: Set User Title ---
    socket.on('admin:setTitle', (data) => {
        if (!isAdmin(socket.id)) return;
        const { userId, title } = data;
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        user.title = (title && typeof title === 'string' && title.trim()) ? title.trim().substring(0, 30) : null;
        saveDB();
        emitBankUpdate();
        socket.emit('admin:full_data', {
            users: db.users.map(u => publicUserAdmin(u, getOnlineUserIds())),
            history: db.history, adminHistory: db.adminHistory,
            onlineCount: getOnlineCount(), groups: getAllGroups(),
            groupPermissions: db.groupPermissions, coupons: db.coupons,
            userCoupons: db.userCoupons, couponNotifications: db.couponNotifications,
            purchaseRequests: db.purchaseRequests, quests: db.quests,
            tasks: db.taskAssignments, duels: db.duels,
            userXP: db.userXP, approvalRequests: db.approvalRequests
        });
        logAdminAction('set_title', userId, user.name, null, null, user.title || 'default');
    });

    // --- Admin: Set User Profile Icon ---
    socket.on('admin:setProfileIcon', (data) => {
        if (!isAdmin(socket.id)) return;
        const { userId, icon } = data;
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const validIcons = ['👤','⭐','👑','🐉','🐼','💎','🐯','🎓','💰','🦁','🔥','🌟','🎯','🚀','🦊','🐺','🎮','🎵','📚','⚡','🌊','🍀','🌙','☀️','💫','🎪','🏆','🎖️','🦅','🦋'];
        if (icon && !validIcons.includes(icon)) { socket.emit('error', { message: 'Недопустимая иконка.' }); return; }
        user.profileIcon = (icon && icon !== '') ? icon : null;
        saveDB();
        emitBankUpdate();
        socket.emit('admin:full_data', {
            users: db.users.map(u => publicUserAdmin(u, getOnlineUserIds())),
            history: db.history, adminHistory: db.adminHistory,
            onlineCount: getOnlineCount(), groups: getAllGroups(),
            groupPermissions: db.groupPermissions, coupons: db.coupons,
            userCoupons: db.userCoupons, couponNotifications: db.couponNotifications,
            purchaseRequests: db.purchaseRequests, quests: db.quests,
            tasks: db.taskAssignments, duels: db.duels,
            userXP: db.userXP, approvalRequests: db.approvalRequests
        });
        logAdminAction('set_profile_icon', userId, user.name, null, null, user.profileIcon || 'default');
    });

    // --- Admin: Set User Level ---
    socket.on('admin:setLevel', (data) => {
        if (!isAdmin(socket.id)) return;
        const { userId, level } = data;
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        if (level === null || level === '' || level === undefined) {
            user.adminLevel = null;
        } else {
            const lvl = Number(level);
            if (!Number.isInteger(lvl) || lvl < 1 || lvl > 100) { socket.emit('error', { message: 'Уровень: 1-100.' }); return; }
            user.adminLevel = lvl;
        }
        saveDB();
        emitBankUpdate();
        socket.emit('admin:full_data', {
            users: db.users.map(u => publicUserAdmin(u, getOnlineUserIds())),
            history: db.history, adminHistory: db.adminHistory,
            onlineCount: getOnlineCount(), groups: getAllGroups(),
            groupPermissions: db.groupPermissions, coupons: db.coupons,
            userCoupons: db.userCoupons, couponNotifications: db.couponNotifications,
            purchaseRequests: db.purchaseRequests, quests: db.quests,
            tasks: db.taskAssignments, duels: db.duels,
            userXP: db.userXP, approvalRequests: db.approvalRequests
        });
        logAdminAction('set_level', userId, user.name, user.adminLevel, null, user.adminLevel ? 'LEVEL ' + user.adminLevel : 'auto');
    });

    // --- Admin: Reset User PIN ---
    socket.on('admin:resetUserPin', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const { userId, newPin } = data;
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const pin = String(newPin || '');
        if (!/^\d{4}$/.test(pin)) { socket.emit('error', { message: 'PIN должен состоять ровно из 4 цифр.' }); return; }
        const { hash, salt } = hashPin(pin);
        user.pinHash = hash;
        user.salt = salt;
        saveDB();
        logAdminAction('reset_user_pin', userId, user.name, null, null, 'PIN сброшен');
        socket.emit('admin:pinResetSuccess', { userId, userName: user.name });
    });

    // --- Admin: Create user (login + password) ---
    socket.on('admin:createUser', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('admin:createUserResult', { success: false, message: 'Требуется доступ администратора.' }); return; }
        const login = sanitizeName(data?.login);
        const password = String(data?.password || '');
        const pin = String(data?.pin || '');
        const displayName = String(data?.displayName || '').trim().slice(0, 40);
        if (!login || login.length < 2 || login.length > 20) {
            socket.emit('admin:createUserResult', { success: false, message: 'Логин: от 2 до 20 символов.' });
            return;
        }
        if (!pin || !/^\d{4}$/.test(pin)) {
            socket.emit('admin:createUserResult', { success: false, message: 'PIN: ровно 4 цифры (обязательно).' });
            return;
        }
        if (password && (password.length < 4 || password.length > 72)) {
            socket.emit('admin:createUserResult', { success: false, message: 'Пароль: от 4 до 72 символов.' });
            return;
        }
        if (findUserByName(login)) {
            socket.emit('admin:createUserResult', { success: false, message: 'Пользователь с таким логином уже существует.' });
            return;
        }
        const pw = password ? hashPassword(password) : null;
        const user = {
            id: genId(),
            name: login,
            displayName: displayName || null,
            balance: 0,
            createdAt: Date.now(),
            lastActive: Date.now(),
            pinHash: null,
            salt: null,
            passwordHash: pw ? pw.hash : null,
            passwordSalt: pw ? pw.salt : null,
            archived: false
        };
        const p = hashPin(pin);
        user.pinHash = p.hash;
        user.salt = p.salt;
        db.users.push(user);
        db.favorites[user.id] = [];
        saveDB();
        logAdminAction('create_user', user.id, user.name, null, null, 'Создан аккаунт: ' + user.name);
        socket.emit('admin:createUserResult', {
            success: true,
            message: 'Аккаунт создан',
            user: { id: user.id, login: user.name, displayName: displayName || null }
        });
        emitBankUpdate();
    });

    // --- Admin: Reset user password ---
    socket.on('admin:resetUserPassword', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('admin:resetPasswordResult', { success: false, message: 'Требуется доступ администратора.' }); return; }
        const user = findUser(data?.userId);
        if (!user) { socket.emit('admin:resetPasswordResult', { success: false, message: 'Пользователь не найден.' }); return; }
        const password = String(data?.password || '');
        if (!password || password.length < 4 || password.length > 72) {
            socket.emit('admin:resetPasswordResult', { success: false, message: 'Пароль: от 4 до 72 символов.' });
            return;
        }
        const pw = hashPassword(password);
        user.passwordHash = pw.hash;
        user.passwordSalt = pw.salt;
        saveDB();
        logAdminAction('reset_user_password', user.id, user.name, null, null, 'Пароль сброшен');
        socket.emit('admin:resetPasswordResult', { success: true, message: 'Пароль обновлён', userId: user.id, userName: user.name });
    });

    // --- Admin: Change user login ---
    socket.on('admin:changeUserLogin', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('admin:changeLoginResult', { success: false, message: 'Требуется доступ администратора.' }); return; }
        const user = findUser(data?.userId);
        if (!user) { socket.emit('admin:changeLoginResult', { success: false, message: 'Пользователь не найден.' }); return; }
        const login = sanitizeName(data?.login);
        if (!login || login.length < 2 || login.length > 20) {
            socket.emit('admin:changeLoginResult', { success: false, message: 'Логин: от 2 до 20 символов.' });
            return;
        }
        const existing = findUserByName(login);
        if (existing && existing.id !== user.id) {
            socket.emit('admin:changeLoginResult', { success: false, message: 'Логин уже занят.' });
            return;
        }
        const old = user.name;
        user.name = login;
        if (data && data.displayName !== undefined) user.displayName = String(data.displayName || '').trim().slice(0, 40) || null;
        saveDB();
        logAdminAction('change_user_login', user.id, login, null, null, old + ' → ' + login);
        socket.emit('admin:changeLoginResult', { success: true, message: 'Логин обновлён', userId: user.id, userName: login });
        emitBankUpdate();
    });

    // --- Admin: Account requests ---
    socket.on('admin:getAccountRequests', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        if (!Array.isArray(db.accountRequests)) db.accountRequests = [];
        const list = db.accountRequests
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 100)
            .map(r => ({ id: r.id, name: r.name, comment: r.comment, timestamp: r.timestamp, status: r.status }));
        socket.emit('admin:accountRequests', { requests: list });
    });

    socket.on('admin:markAccountRequest', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const id = data?.id;
        const req = (db.accountRequests || []).find(r => r.id === id);
        if (!req) { socket.emit('error', { message: 'Запрос не найден.' }); return; }
        req.status = 'read';
        saveDB();
        socket.emit('admin:accountRequestMarked', { id: req.id, status: req.status });
    });

    // --- User Transfer ---
    socket.on('bank:send', (data) => {
        if (denyIfGuestOrMaintenance(socket, 'error')) return;
        const userId = socketUserMap.get(socket.id);
        const sender = findUser(userId);
        if (!sender) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }

        const recipientId = data?.recipientId;
        const amount = Number(data?.amount);
        const messageClean = sanitizeTextNoUrl(data?.message, 300);
        if (data?.message && messageClean === null) {
            appendAudit({ actorId: sender.id, actorName: sender.name, actorRole: 'student', action: 'transfer_blocked', target: recipientId, result: 'error', source: 'socket', reason: 'URL в сообщении перевода' });
            socket.emit('error', { message: 'Ссылки в сообщении перевода запрещены.' });
            return;
        }
        const message = messageClean || '';

        if (!recipientId) { socket.emit('error', { message: 'Выберите получателя.' }); return; }
        if (recipientId === sender.id) { socket.emit('error', { message: 'Нельзя перевести самому себе.' }); return; }
        const recipient = findUser(recipientId);
        if (!recipient) { socket.emit('error', { message: 'Получатель не найден.' }); return; }
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) {
            socket.emit('error', { message: 'Некорректная сумма.' }); return;
        }
        if (sender.balance < amount) { socket.emit('error', { message: 'Недостаточно средств.' }); return; }

        sender.balance -= amount;
        recipient.balance += amount;
        touchUser(sender); touchUser(recipient);

        const tx = {
            id: genId(), type: 'transfer',
            from: sender.name, to: recipient.name,
            fromId: sender.id, toId: recipient.id,
            userId: sender.id, userName: sender.name,
            amount, timestamp: Date.now(),
            description: `Перевод → ${recipient.name}`,
            message, oldBalance: sender.balance + amount, newBalance: sender.balance
        };
        db.history.push(tx);

        const txRecipient = {
            ...tx, id: genId(), userId: recipient.id, userName: recipient.name,
            description: `Получено от ${sender.name}`,
            oldBalance: recipient.balance - amount, newBalance: recipient.balance
        };
        db.history.push(txRecipient);

        if (message) {
            const msg = { id: genId(), from: sender.name, fromId: sender.id, to: recipient.name, toId: recipient.id, text: message, timestamp: Date.now() };
            db.messages.push(msg);
            emitToUser(recipient.id, 'message:new', msg);
        }

        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('transfer:success', { tx, recipient: recipient.name });
        emitToUser(recipient.id, 'transaction:new', txRecipient);
        emitToUser(recipient.id, 'notification:new', { type: 'received', from: sender.name, amount, message });
        emitBankUpdate();
    });

    // --- Messages (costs 10 per message) ---
    socket.on('message:send', (data) => {
        const userId = socketUserMap.get(socket.id);
        const sender = findUser(userId);
        if (!sender) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const recipient = findUser(data?.toId);
        if (!recipient) { socket.emit('error', { message: 'Получатель не найден.' }); return; }
        if (payloadHasAttachment(data)) {
            appendAudit({ actorId: sender.id, actorName: sender.name, actorRole: 'student', action: 'message_send_blocked', target: recipient.name, result: 'error', source: 'socket', reason: 'Вложение запрещено' });
            socket.emit('error', { message: 'Вложения и файлы запрещены. Отправьте только текст без ссылок.' });
            return;
        }
        const text = sanitizeTextNoUrl(data?.text, 500);
        if (text == null) {
            appendAudit({ actorId: sender.id, actorName: sender.name, actorRole: 'student', action: 'message_send_blocked', target: recipient.name, result: 'error', source: 'socket', reason: 'URL в тексте запрещён' });
            socket.emit('error', { message: 'Ссылки запрещены. Уберите URL из сообщения и отправьте обычный текст.' });
            return;
        }
        if (!text || text.length > 500) { socket.emit('error', { message: 'Сообщение 1-500 символов.' }); return; }
        if (sender.balance < 10) { socket.emit('error', { message: 'Недостаточно средств. Отправка сообщения стоит 10 分.' }); return; }

        // Charge 10 for the message
        const oldBalance = sender.balance;
        sender.balance -= 10;
        touchUser(sender);

        const msg = { id: genId(), from: sender.name, fromId: sender.id, to: recipient.name, toId: recipient.id, text, timestamp: Date.now() };
        db.messages.push(msg);

        // Log the fee transaction
        const feeTx = {
            id: genId(), type: 'message_fee',
            userId: sender.id, userName: sender.name,
            amount: 10, timestamp: Date.now(),
            description: 'Отправка сообщения → ' + recipient.name,
            oldBalance, newBalance: sender.balance
        };
        db.history.push(feeTx);

        saveDB();
        socket.emit('message:new', msg);
        socket.emit('transaction:new', feeTx);
        emitToUser(recipient.id, 'message:new', msg);
        emitToUser(recipient.id, 'notification:new', { type: 'message', from: sender.name, text });
        emitBankUpdate();
    });

    // Clear all messages for current user
    socket.on('messages:clearAll', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        db.messages = db.messages.filter(m => m.fromId !== userId && m.toId !== userId);
        saveDB();
        socket.emit('messages:clearAll:result', { success: true });
    });

    // --- Favorites ---
    socket.on('favorites:toggle', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        if (!db.favorites[userId]) db.favorites[userId] = [];
        const idx = db.favorites[userId].indexOf(data?.targetId);
        if (idx >= 0) db.favorites[userId].splice(idx, 1);
        else if (data?.targetId) db.favorites[userId].push(data.targetId);
        saveDB();
        socket.emit('favorites:update', { favorites: db.favorites[userId] });
    });

    // --- Notifications ---
    socket.on('notifications:get', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const notifs = db.notifications.filter(n => n.targetUserId === userId).sort((a, b) => b.timestamp - a.timestamp);
        socket.emit('notifications:list', { notifications: notifs });
    });

    socket.on('notifications:read', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const notif = db.notifications.find(n => n.id === data?.notifId && n.targetUserId === userId);
        if (notif) {
            notif.read = true;
            saveDB();
        }
        socket.emit('notifications:list', {
            notifications: db.notifications.filter(n => n.targetUserId === userId).sort((a, b) => b.timestamp - a.timestamp)
        });
    });

    // ==================== ADMIN OPERATIONS ====================

    // --- Admin: Add Money ---
    socket.on('admin:addMoney', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.targetId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const amount = Number(data?.amount);
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        const oldBalance = target.balance;
        target.balance += amount;
        touchUser(target);
        const isStart = data?.isStartCapital;
        const desc = data?.message || (isStart ? 'Стартовый капитал' : 'Начисление');
        const tx = {
            id: genId(), type: isStart ? 'start_capital' : 'add',
            userId: target.id, userName: target.name,
            amount, timestamp: Date.now(),
            description: desc, message: data?.message || '',
            oldBalance, newBalance: target.balance
        };
        db.history.push(tx);
        logAdminAction(isStart ? 'start_capital' : 'add_money', target.id, target.name, amount, desc, null);
        saveDB();
        io.emit('transaction:new', tx);
        emitBankUpdate();
        emitToUser(target.id, 'notification:new', { type: 'received', from: 'Администратор', message: desc, amount });
    });

    // --- Admin: Mass Add ---
    socket.on('admin:massAdd', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetIds = Array.isArray(data?.targetIds) ? data.targetIds : [];
        const amount = Number(data?.amount);
        const reason = (data?.reason || '').trim() || 'Начисление';
        if (!targetIds.length) { socket.emit('error', { message: 'Выберите пользователей.' }); return; }
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        const results = [];
        for (const tid of targetIds) {
            const target = findUser(tid);
            if (!target) continue;
            const oldBalance = target.balance;
            target.balance += amount;
            touchUser(target);
            const tx = {
                id: genId(), type: data?.isStartCapital ? 'start_capital' : 'add',
                userId: target.id, userName: target.name,
                amount, timestamp: Date.now(),
                description: reason, message: reason,
                oldBalance, newBalance: target.balance
            };
            db.history.push(tx);
            results.push({ name: target.name, success: true });
            emitToUser(target.id, 'notification:new', { type: 'received', from: 'Администратор', message: reason, amount });
        }
        logAdminAction(data?.isStartCapital ? 'mass_start_capital' : 'mass_add', null, null, amount, reason, `${results.length} пользователей`);
        saveDB();
        io.emit('bank:update', { users: db.users.filter(u => !u.archived).map(u => publicUserLight(u, getOnlineUserIds())), onlineCount: getOnlineCount() });
        emitBankUpdate();
        socket.emit('admin:massResult', { results });
    });

    // --- Admin: Send Money (Transfer from admin) ---
    socket.on('admin:sendMoney', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.targetId);
        if (!target) { socket.emit('error', { message: 'Получатель не найден.' }); return; }
        const amount = Number(data?.amount);
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        const oldBalance = target.balance;
        target.balance += amount; touchUser(target);
        const desc = data?.message || 'Перевод от администратора';
        const tx = {
            id: genId(), type: 'transfer',
            from: 'Администратор', to: target.name,
            fromId: 'admin', toId: target.id,
            userId: target.id, userName: target.name,
            amount, timestamp: Date.now(),
            description: desc, message: data?.message || '',
            oldBalance, newBalance: target.balance
        };
        db.history.push(tx);
        logAdminAction('send_money', target.id, target.name, amount, desc, null);
        saveDB();
        io.emit('transaction:new', tx);
        emitBankUpdate();
        emitToUser(target.id, 'notification:new', { type: 'received', from: 'Администратор', message: desc, amount });
    });

    // --- Admin: Fine ---
    socket.on('admin:fine', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetIds = Array.isArray(data?.targetIds) ? data.targetIds : [data?.targetId];
        const amount = Number(data?.amount);
        const reason = (data?.reason || '').trim();
        if (!reason) { socket.emit('error', { message: 'Причина штрафа обязательна.' }); return; }
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        const results = [];
        for (const tid of targetIds) {
            const target = findUser(tid);
            if (!target) continue;
            if (target.balance < amount) { results.push({ name: target.name, success: false, reason: 'Недостаточно средств' }); continue; }
            const oldBalance = target.balance;
            target.balance -= amount; touchUser(target);
            const tx = {
                id: genId(), type: 'fine',
                userId: target.id, userName: target.name,
                amount, timestamp: Date.now(),
                description: 'Штраф', reason, oldBalance, newBalance: target.balance
            };
            db.history.push(tx);
            results.push({ name: target.name, success: true });
            emitToUser(target.id, 'notification:new', { type: 'fine', reason, amount });
        }
        logAdminAction('fine', null, null, amount, reason, `${results.filter(r => r.success).length} пользователей`);
        saveDB();
        emitBankUpdate();
        socket.emit('admin:fineResult', { results });
    });

    // --- Admin: Edit Balance ---
    socket.on('admin:editBalance', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.targetId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const newBalance = Number(data?.newBalance);
        const reason = (data?.reason || '').trim() || 'Корректировка баланса';
        if (!Number.isFinite(newBalance)) { socket.emit('error', { message: 'Некорректное значение.' }); return; }
        const oldBalance = target.balance;
        target.balance = newBalance; touchUser(target);
        const tx = {
            id: genId(), type: 'edit_balance',
            userId: target.id, userName: target.name,
            amount: newBalance - oldBalance, timestamp: Date.now(),
            description: 'Корректировка баланса', reason,
            oldBalance, newBalance: target.balance
        };
        db.history.push(tx);
        logAdminAction('edit_balance', target.id, target.name, newBalance - oldBalance, reason, `${oldBalance} → ${newBalance}`);
        saveDB();
        io.emit('transaction:new', tx);
        emitBankUpdate();
        emitToUser(target.id, 'notification:new', { type: 'edit', oldBalance, newBalance, reason });
    });

    // --- Admin: Remove User ---
    socket.on('admin:remove', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetId = data?.targetId;
        const target = findUser(targetId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const targetName = target.name;
        const uid = targetId;

        // Remove user from users array
        db.users = db.users.filter(u => u.id !== uid);

        // Clean up all user-specific data
        db.history = db.history.filter(h => h.userId !== uid && h.fromId !== uid && h.toId !== uid);
        db.messages = db.messages.filter(m => m.fromId !== uid && m.toId !== uid);
        db.notifications = db.notifications.filter(n => n.targetUserId !== uid);
        db.userCoupons = db.userCoupons.filter(c => c.userId !== uid);
        db.couponNotifications = db.couponNotifications.filter(n => n.userId !== uid);
        db.investments = db.investments.filter(i => i.userId !== uid);
        db.sessions = db.sessions.filter(s => s.userId !== uid);
        db.approvalRequests = db.approvalRequests.filter(r => r.userId !== uid);
        db.purchaseRequests = db.purchaseRequests.filter(r => r.userId !== uid);
        db.rests = db.rests.filter(r => r.userId !== uid);
        db.userBlocks = db.userBlocks.filter(b => b.userId !== uid);
        db.qrTerminalHistory = db.qrTerminalHistory.filter(h => h.userId !== uid);
        db.userPromoActivations = db.userPromoActivations.filter(a => a.userId !== uid);
        if (db.userBankDeposits) db.userBankDeposits = db.userBankDeposits.filter(d => d.userId !== uid);
        if (db.userBankInvestments) db.userBankInvestments = db.userBankInvestments.filter(i => i.userId !== uid);
        if (db.bankHistory) db.bankHistory = db.bankHistory.filter(h => h.userId !== uid);
        if (db.journal && Array.isArray(db.journal.students)) {
            const jIds = db.journal.students.filter(s => s && s.userId === uid).map(s => s.id);
            db.journal.students = db.journal.students.filter(s => s && s.userId !== uid);
            if (jIds.length && Array.isArray(db.journal.records)) {
                db.journal.records = db.journal.records.filter(r => r && !jIds.includes(r.studentId));
            }
        }

        // Delete user's keyed data
        delete db.favorites[uid];
        delete db.userXP[uid];
        delete db.userLists[uid];
        if (db.battlePass && db.battlePass.userProgress) delete db.battlePass.userProgress[uid];

        // Remove user's submissions from quests/tasks/duels
        db.quests.forEach(q => {
            if (q.submissions) q.submissions = q.submissions.filter(s => s.userId !== uid);
        });
        db.taskAssignments.forEach(t => {
            if (t.submissions) t.submissions = t.submissions.filter(s => s.userId !== uid);
        });
        db.duels.forEach(d => {
            if (d.participants) d.participants = d.participants.filter(p => p.userId !== uid);
        });

        logAdminAction('remove_user', targetId, targetName, null, null, `Удалён пользователь: ${targetName}`);
        saveDB();
        // Force disconnect all sockets of this user
        const sockets = getUserSockets(targetId);
        for (const sid of sockets) {
            io.to(sid).emit('force_disconnect', { message: 'Вы удалены администратором.' });
            removeSocket(sid);
        }
        emitBankUpdate();
        socket.emit('admin:userDeleted', { userId: targetId, userName: targetName });
    });

    // --- Admin: Archive User (hide from active lists, keep all history) ---
    socket.on('admin:archiveUser', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.userId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        if (target.archived) { socket.emit('error', { message: 'Ученик уже в архиве.' }); return; }
        target.archived = true;
        touchUser(target);
        saveDB();
        logAdminAction('archive_user', target.id, target.name, null, null, 'Ученик отправлен в архив');
        emitBankUpdate();
        socket.emit('admin:userArchived', { userId: target.id, userName: target.name, archived: true });
    });

    // --- Admin: Restore User from archive ---
    socket.on('admin:restoreUser', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.userId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        if (!target.archived) { socket.emit('error', { message: 'Ученик не в архиве.' }); return; }
        target.archived = false;
        touchUser(target);
        saveDB();
        logAdminAction('restore_user', target.id, target.name, null, null, 'Ученик восстановлен из архива');
        emitBankUpdate();
        socket.emit('admin:userArchived', { userId: target.id, userName: target.name, archived: false });
    });

    // --- Admin: Withdraw ---
    socket.on('admin:withdraw', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.targetId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const amount = Number(data?.amount);
        const reason = (data?.reason || '').trim();
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        if (!reason) { socket.emit('error', { message: 'Причина изъятия обязательна.' }); return; }
        if (target.balance < amount) { socket.emit('error', { message: 'Недостаточно средств у пользователя. Баланс: ' + target.balance + ' 分' }); return; }
        const oldBalance = target.balance;
        target.balance -= amount; touchUser(target);
        const tx = {
            id: genId(), type: 'withdraw',
            userId: target.id, userName: target.name,
            amount, timestamp: Date.now(),
            description: 'Изъятие средств', reason, oldBalance, newBalance: target.balance
        };
        db.history.push(tx);
        logAdminAction('withdraw', target.id, target.name, amount, reason, null);
        saveDB();
        io.emit('transaction:new', tx);
        emitBankUpdate();
        emitToUser(target.id, 'notification:new', { type: 'withdraw', reason, amount });
    });

    // --- Admin: Transfer Between Users ---
    socket.on('admin:transferBetween', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const sender = findUser(data?.senderId);
        const recipient = findUser(data?.recipientId);
        if (!sender) { socket.emit('error', { message: 'Отправитель не найден.' }); return; }
        if (!recipient) { socket.emit('error', { message: 'Получатель не найден.' }); return; }
        if (sender.id === recipient.id) { socket.emit('error', { message: 'Нельзя перевести самому себе.' }); return; }
        const amount = Number(data?.amount);
        const message = (data?.message || '').trim();
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        if (sender.balance < amount) { socket.emit('error', { message: 'Недостаточно средств у ' + sender.name + '. Баланс: ' + sender.balance + ' 分' }); return; }
        const senderOld = sender.balance, recipOld = recipient.balance;
        sender.balance -= amount; recipient.balance += amount;
        touchUser(sender); touchUser(recipient);
        const txS = {
            id: genId(), type: 'transfer',
            from: sender.name, to: recipient.name,
            fromId: sender.id, toId: recipient.id,
            userId: sender.id, userName: sender.name,
            amount, timestamp: Date.now(),
            description: `Перевод → ${recipient.name} (админ)`,
            message, oldBalance: senderOld, newBalance: sender.balance, adminNote: true
        };
        const txR = {
            ...txS, id: genId(), userId: recipient.id, userName: recipient.name,
            description: `Получено от ${sender.name} (админ)`,
            oldBalance: recipOld, newBalance: recipient.balance
        };
        db.history.push(txS); db.history.push(txR);
        logAdminAction('transfer_between', null, null, amount, message || 'Перевод между пользователями', `${sender.name} → ${recipient.name}`);
        saveDB();
        io.emit('transaction:new', txS);
        io.emit('transaction:new', txR);
        emitBankUpdate();
        emitToUser(recipient.id, 'notification:new', { type: 'received', from: sender.name, amount, message });
        emitToUser(sender.id, 'notification:new', { type: 'sent', to: recipient.name, amount, message });
    });

    // --- Admin: Send Notification ---
    socket.on('admin:sendNotification', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetIds = Array.isArray(data?.targetIds) ? data.targetIds : [];
        const title = sanitizeTextNoUrl(data?.title, 80) || '';
        const text = sanitizeTextNoUrl(data?.text, 500);
        if (payloadHasAttachment(data) || text === null) {
            appendAudit({ actorRole: 'admin', action: 'notification_blocked', target: 'users', result: 'error', source: 'admin_ui', reason: 'URL или вложение в уведомлении' });
            socket.emit('error', { message: 'Ссылки и вложения в уведомлениях запрещены. Отправьте обычный текст.' });
            return;
        }
        if (!targetIds.length) { socket.emit('error', { message: 'Выберите получателей.' }); return; }
        if (!text) { socket.emit('error', { message: 'Введите текст уведомления.' }); return; }

        const allUsers = targetIds.includes('all');
        const recipients = allUsers ? db.users.map(u => u.id) : targetIds;
        const recipientNames = [];

        for (const tid of recipients) {
            const target = findUser(tid);
            if (!target) continue;
            recipientNames.push(target.name);
            const notif = {
                id: genId(),
                targetUserId: tid,
                title: title || 'Уведомление',
                text,
                timestamp: Date.now(),
                read: false,
                senderName: 'Администратор'
            };
            db.notifications.push(notif);
            emitToUser(tid, 'notification:push', notif);
        }

        const targetDesc = allUsers ? 'Все пользователи' : recipientNames.join(', ');
        logAdminAction('send_notification', null, targetDesc, null, title, text);
        saveDB();
        socket.emit('admin:notifSent', { count: recipients.length });
    });

    // --- Admin: Get Admin History ---
    socket.on('admin:getAdminHistory', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        socket.emit('admin:history', { adminHistory: db.adminHistory.sort((a, b) => b.timestamp - a.timestamp) });
    });

    // --- Audit log (read-only; append-only on server, no delete/edit API) ---
    socket.on('audit:query', (data) => {
        const token = data && data.adminToken ? String(data.adminToken) : '';
        const ok = isAdmin(socket.id) || validateAdminSessionToken(token);
        if (!ok) {
            appendAudit({ actorRole: 'system', action: 'audit_denied', result: 'error', source: 'socket', reason: 'Попытка доступа к журналу без прав' });
            socket.emit('audit:result', { ok: false, error: 'Доступ запрещён' });
            return;
        }
        adminSockets.add(socket.id);
        ensureAuditLog();
        const tab = String(data?.tab || 'all');
        const q = String(data?.q || '').toLowerCase().slice(0, 80);
        const from = Number(data?.from) || 0;
        const to = Number(data?.to) || 0;
        const userFilter = String(data?.userFilter || '');
        const page = Math.max(1, Number(data?.page) || 1);
        const pageSize = Math.min(50, Math.max(10, Number(data?.pageSize) || 25));

        // Unified feed: audit + adminHistory + securityLog + financial ops
        let items = db.auditLog.map(r => ({
            id: r.id, ts: r.ts, actorId: r.actorId, actorName: r.actorName, actorRole: r.actorRole,
            action: r.action, target: r.target, oldValue: r.oldValue, newValue: r.newValue,
            result: r.result, source: r.source, reason: r.reason, hash: r.hash, prevHash: r.prevHash,
            kind: 'audit'
        }));
        (db.adminHistory || []).forEach(h => {
            items.push({
                id: h.id, ts: h.timestamp || h.ts, actorId: null, actorName: 'Администратор', actorRole: 'admin',
                action: h.action || 'admin_action', target: h.targetUserName || h.targetUserId || h.details || null,
                oldValue: null, newValue: h.amount ? String(h.amount) : (h.details || ''),
                result: 'success', source: 'admin_ui', reason: h.reason || null, hash: null, prevHash: null, kind: 'admin'
            });
        });
        (db.securityLog || []).forEach(s => {
            items.push({
                id: s.id, ts: s.timestamp || s.ts, actorId: null, actorName: s.target || '—', actorRole: 'system',
                action: 'security_' + (s.type || 'event'), target: s.target || null,
                oldValue: null, newValue: null, result: 'error', source: 'security',
                reason: s.details || null, hash: null, prevHash: null, kind: 'security'
            });
        });
        (db.history || []).slice(-400).forEach(tx => {
            items.push({
                id: tx.id, ts: tx.timestamp || Date.now(), actorId: tx.userId || tx.fromId || null,
                actorName: tx.userName || tx.from || tx.to || null,
                actorRole: (tx.fromId === 'admin' || tx.type === 'journal_reward') ? 'student' : 'student',
                action: 'tx_' + (tx.type || 'op'), target: tx.description || tx.to || null,
                oldValue: tx.oldBalance == null ? null : String(tx.oldBalance),
                newValue: tx.newBalance == null ? (tx.amount != null ? String(tx.amount) : null) : String(tx.newBalance),
                result: 'success', source: 'bank', reason: tx.reason || null, hash: null, prevHash: null, kind: 'change'
            });
        });

        items.sort((a, b) => (b.ts || 0) - (a.ts || 0));

        if (tab === 'admin') items = items.filter(r => r.actorRole === 'admin' || r.kind === 'admin');
        else if (tab === 'student') items = items.filter(r => r.actorRole === 'student');
        else if (tab === 'security') items = items.filter(r => r.actorRole === 'system' || r.kind === 'security' || r.result === 'error' || String(r.action).indexOf('security_') === 0);
        else if (tab === 'changes') items = items.filter(r => r.kind === 'change' || r.oldValue != null || r.newValue != null);

        if (q) {
            items = items.filter(r => {
                const hay = ((r.action || '') + ' ' + (r.actorName || '') + ' ' + (r.target || '') + ' ' + (r.reason || '') + ' ' + (r.newValue || '') + ' ' + (r.oldValue || '')).toLowerCase();
                return hay.indexOf(q) >= 0;
            });
        }
        if (userFilter) {
            const uf = userFilter.toLowerCase();
            items = items.filter(r => (r.actorId && String(r.actorId).toLowerCase().indexOf(uf) >= 0) ||
                (r.actorName && String(r.actorName).toLowerCase().indexOf(uf) >= 0));
        }
        if (from) items = items.filter(r => (r.ts || 0) >= from);
        if (to) items = items.filter(r => (r.ts || 0) <= to);

        const total = items.length;
        const start = (page - 1) * pageSize;
        const pageItems = items.slice(start, start + pageSize);
        socket.emit('audit:result', {
            ok: true,
            total,
            page,
            pageSize,
            items: pageItems,
            integrity: {
                mode: 'append-only-hash-chain',
                note: 'Все действия программы. Удаление/редактирование через API недоступно.'
            }
        });
    });

    // --- Admin: Backup ---
    socket.on('admin:backup', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const backup = {
            version: '2.2',
            timestamp: Date.now(),
            users: db.users.map(u => ({ ...u, passwordHash: u.passwordHash || null, passwordSalt: u.passwordSalt || null })), // Preserve pinHash and salt so PINs survive restore
            history: db.history,
            messages: db.messages,
            favorites: db.favorites,
            notifications: db.notifications,
            adminHistory: db.adminHistory,
            groups: getAllGroups(),
            groupPermissions: db.groupPermissions,
            coupons: db.coupons,
            userCoupons: db.userCoupons,
            couponNotifications: db.couponNotifications,
            investments: db.investments,
            purchaseRequests: db.purchaseRequests,
            quests: db.quests,
            taskAssignments: db.taskAssignments,
            duels: db.duels,
            userXP: db.userXP,
            approvalRequests: db.approvalRequests,
            rests: db.rests,
            userBlocks: db.userBlocks,
            qrTerminalHistory: db.qrTerminalHistory,
            battlePass: db.battlePass,
            btcPrice: db.btcPrice,
            investmentPrices: db.investmentPrices,
            promocodes: db.promocodes,
            userPromoActivations: db.userPromoActivations,
            journal: getJournalData(),
            exams: getExamsData(),
            testResults: db.testResults || [],
            accountRequests: db.accountRequests || [],
            securityLog: db.securityLog || [],
            auditLog: db.auditLog || [],
            globalMode: db.globalMode || {},
            maintenanceMode: db.maintenanceMode || {},
            guestMode: db.guestMode || {},
            savingsGoals: db.savingsGoals || [],
            bankQuests: db.bankQuests || [],
            virtualBanks: db.virtualBanks || null,
            userBankDeposits: db.userBankDeposits || [],
            userBankInvestments: db.userBankInvestments || [],
            bankHistory: db.bankHistory || [],
            qrCodes: db.qrCodes || [],
            qrAccounts: db.qrAccounts || [],
            qrCodeScans: db.qrCodeScans || [],
            couponPricesHalved: db.couponPricesHalved || false
        };
        socket.emit('admin:backup_data', { backup });
        logAdminAction('backup', null, null, null, null, 'Создана резервная копия');
        saveDB();
    });

    // --- Admin: Restore Preview ---
    socket.on('admin:restore_preview', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const backup = data?.backup;
        if (!backup || !Array.isArray(backup.users)) {
            socket.emit('error', { message: 'Неверный формат резервной копии.' });
            return;
        }
        socket.emit('admin:restore_preview_data', {
            userCount: backup.users.length,
            historyCount: (backup.history || []).length,
            version: backup.version || 'unknown',
            timestamp: backup.timestamp || null,
            users: backup.users.map(u => ({ name: u.name, balance: typeof u.balance === 'number' ? u.balance : 0, hasPin: !!u.pinHash }))
        });
    });

    // --- Admin: Restore ---
    socket.on('admin:restore', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const backup = data?.backup;
        if (!backup || !Array.isArray(backup.users)) {
            socket.emit('error', { message: 'Неверный формат резервной копии.' });
            return;
        }
        // Save current as auto-backup before replacing
        const autoBackup = JSON.stringify(db, null, 2);
        try {
            const autoPath = path.join(__dirname, `backup_${Date.now()}.json`);
            fs.writeFileSync(autoPath, autoBackup, 'utf-8');
        } catch (e) { /* ignore */ }

        // Preserve admin PIN and salt before restore (they are not in backup)
        const savedAdminPinHash = db.adminPinHash;
        const savedAdminSalt = db.adminSalt;

        // Safe restore: overwrite each field only if present in backup
        // This ensures old backups (v2.0) don't destroy fields they didn't include
        db.users = Array.isArray(backup.users) ? backup.users : db.users;
        db.history = Array.isArray(backup.history) ? backup.history : [];
        db.messages = Array.isArray(backup.messages) ? backup.messages : [];
        db.favorites = (typeof backup.favorites === 'object' && backup.favorites) ? backup.favorites : {};
        db.notifications = Array.isArray(backup.notifications) ? backup.notifications : [];
        db.adminHistory = Array.isArray(backup.adminHistory) ? backup.adminHistory : [];
        if (Array.isArray(backup.groups)) db.groups = backup.groups;
        if (typeof backup.groupPermissions === 'object' && backup.groupPermissions) db.groupPermissions = backup.groupPermissions;
        if (Array.isArray(backup.investments)) db.investments = backup.investments;
        db.coupons = Array.isArray(backup.coupons) ? backup.coupons : [];
        db.userCoupons = Array.isArray(backup.userCoupons) ? backup.userCoupons : [];
        db.couponNotifications = Array.isArray(backup.couponNotifications) ? backup.couponNotifications : [];
        if (Array.isArray(backup.purchaseRequests)) db.purchaseRequests = backup.purchaseRequests;
        db.quests = Array.isArray(backup.quests) ? backup.quests : [];
        db.taskAssignments = Array.isArray(backup.taskAssignments) ? backup.taskAssignments : [];
        db.duels = Array.isArray(backup.duels) ? backup.duels : [];
        db.userXP = (typeof backup.userXP === 'object' && backup.userXP) ? backup.userXP : {};
        db.sessions = Array.isArray(backup.sessions) ? backup.sessions : [];
        db.approvalRequests = Array.isArray(backup.approvalRequests) ? backup.approvalRequests : [];
        if (Array.isArray(backup.rests)) db.rests = backup.rests;
        if (Array.isArray(backup.userBlocks)) db.userBlocks = backup.userBlocks;
        if (Array.isArray(backup.qrTerminalHistory)) db.qrTerminalHistory = backup.qrTerminalHistory;
        if (typeof backup.battlePass === 'object' && backup.battlePass) db.battlePass = backup.battlePass;
        if (typeof backup.btcPrice === 'number' && isFinite(backup.btcPrice)) db.btcPrice = backup.btcPrice;
        if (typeof backup.investmentPrices === 'object' && backup.investmentPrices) db.investmentPrices = backup.investmentPrices;
        db.promocodes = Array.isArray(backup.promocodes) ? backup.promocodes : [];
        db.userPromoActivations = Array.isArray(backup.userPromoActivations) ? backup.userPromoActivations : [];
        // Restore new fields (v2.2+)
        if (backup.journal && typeof backup.journal === 'object') db.journal = backup.journal;
        if (backup.exams && typeof backup.exams === 'object') db.exams = backup.exams;
        if (Array.isArray(backup.testResults)) db.testResults = backup.testResults;
        if (Array.isArray(backup.accountRequests)) db.accountRequests = backup.accountRequests;
        if (Array.isArray(backup.securityLog)) db.securityLog = backup.securityLog;
        if (Array.isArray(backup.auditLog)) db.auditLog = backup.auditLog;
        if (backup.globalMode && typeof backup.globalMode === 'object') db.globalMode = backup.globalMode;
        if (backup.maintenanceMode && typeof backup.maintenanceMode === 'object') db.maintenanceMode = backup.maintenanceMode;
        if (backup.guestMode && typeof backup.guestMode === 'object') db.guestMode = backup.guestMode;
        if (Array.isArray(backup.savingsGoals)) db.savingsGoals = backup.savingsGoals;
        if (Array.isArray(backup.bankQuests)) db.bankQuests = backup.bankQuests;
        if (backup.virtualBanks !== undefined) db.virtualBanks = backup.virtualBanks;
        if (Array.isArray(backup.userBankDeposits)) db.userBankDeposits = backup.userBankDeposits;
        if (Array.isArray(backup.userBankInvestments)) db.userBankInvestments = backup.userBankInvestments;
        if (Array.isArray(backup.bankHistory)) db.bankHistory = backup.bankHistory;
        if (Array.isArray(backup.qrCodes)) db.qrCodes = backup.qrCodes;
        if (Array.isArray(backup.qrAccounts)) db.qrAccounts = backup.qrAccounts;
        if (Array.isArray(backup.qrCodeScans)) db.qrCodeScans = backup.qrCodeScans;
        if (typeof backup.couponPricesHalved === 'boolean') db.couponPricesHalved = backup.couponPricesHalved;

        // Restore admin PIN (never overwritten by backup)
        db.adminPinHash = savedAdminPinHash;
        db.adminSalt = savedAdminSalt;

        // Run migrations on restored data (safe — only sets defaults for missing/invalid fields)
        _runMigrations();

        saveDB();
        logAdminAction('restore', null, null, null, null, 'Восстановление из резервной копии v' + (backup.version || '?'));
        saveDB();
        // Disconnect all non-admin users so they re-authenticate with fresh data
        for (const [sid, uid] of socketUserMap.entries()) {
            if (!adminSockets.has(sid)) {
                io.to(sid).emit('force_disconnect', { message: 'База данных восстановлена. Войдите заново.' });
                removeSocket(sid);
            }
        }
        emitBankUpdate();
        socket.emit('admin:restore_success', { success: true });
    });

    // --- Admin: Reset All ---
    socket.on('admin:resetAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        db.users = []; db.history = []; db.messages = []; db.favorites = {}; db.notifications = []; db.adminHistory = []; db.coupons = []; db.userCoupons = []; db.couponNotifications = []; db.quests = []; db.taskAssignments = []; db.duels = []; db.userXP = {}; db.sessions = []; db.approvalRequests = []; db.promocodes = []; db.userPromoActivations = [];
        // Keep admin PIN
        saveDB();
        for (const [sid] of socketUserMap.entries()) {
            if (!adminSockets.has(sid)) {
                io.to(sid).emit('force_disconnect', { message: 'База данных сброшена.' });
                removeSocket(sid);
            }
        }
        emitBankUpdate();
    });

    // ==================== GROUP OPERATIONS ====================

    // --- Admin: Create Group ---
    socket.on('admin:createGroup', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const name = sanitizeName(data?.name);
        const number = Number(data?.number);
        if (!name) { socket.emit('error', { message: 'Введите название группы.' }); return; }
        const group = { id: genId(), name, number: Number.isInteger(number) && number >= 1 ? number : undefined, createdAt: Date.now() };
        // Unified: save to journal groups (single source of truth)
        const j = getJournalData();
        j.groups.push(group);
        // Also mirror to legacy db.groups for backward compatibility
        db.groups.push(group);
        logAdminAction('create_group', null, name, null, null, number ? `Группа #${number}` : 'Группа создана');
        saveDB();
        emitBankUpdate();
        emitJournalUpdate();
        socket.emit('admin:groupCreated', { group });
    });

    // --- Admin: Rename Group ---
    socket.on('admin:renameGroup', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const j = getJournalData();
        let group = j.groups.find(g => g.id === data?.groupId);
        if (!group) group = db.groups.find(g => g.id === data?.groupId);
        if (!group) { socket.emit('error', { message: 'Группа не найдена.' }); return; }
        const name = sanitizeName(data?.name);
        if (!name) { socket.emit('error', { message: 'Введите название.' }); return; }
        group.name = name;
        if (data?.number !== undefined) group.number = Number(data.number);
        // Sync both stores
        const legacy = db.groups.find(g => g.id === group.id);
        if (legacy) { legacy.name = name; if (data?.number !== undefined) legacy.number = Number(data.number); }
        const jg = j.groups.find(g => g.id === group.id);
        if (jg) { jg.name = name; if (data?.number !== undefined) jg.number = Number(data.number); }
        logAdminAction('rename_group', null, name, null, null, null);
        saveDB();
        emitBankUpdate();
        emitJournalUpdate();
    });

    // --- Admin: Delete Group ---
    socket.on('admin:deleteGroup', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const groupId = data?.groupId;
        db.groups = db.groups.filter(g => g.id !== groupId);
        const j = getJournalData();
        j.groups = j.groups.filter(g => g.id !== groupId);
        db.users.forEach(u => { if (u.groupId === groupId) u.groupId = null; });
        delete db.groupPermissions[groupId];
        logAdminAction('delete_group', null, null, null, null, null);
        saveDB();
        emitBankUpdate();
        emitJournalUpdate();
    });

    // --- Admin: Add User to Group ---
    socket.on('admin:addToGroup', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const user = findUser(data?.userId);
        const group = db.groups.find(g => g.id === data?.groupId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        if (!group) { socket.emit('error', { message: 'Группа не найдена.' }); return; }
        user.groupId = group.id;
        logAdminAction('add_to_group', user.id, user.name, null, null, `→ ${group.name}`);
        saveDB();
        emitBankUpdate();
    });

    // --- Admin: Remove User from Group ---
    socket.on('admin:removeFromGroup', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const user = findUser(data?.userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        user.groupId = null;
        logAdminAction('remove_from_group', user.id, user.name, null, null, null);
        saveDB();
        emitBankUpdate();
    });

    // --- Admin: Move User to Group ---
    socket.on('admin:moveToGroup', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const user = findUser(data?.userId);
        const group = db.groups.find(g => g.id === data?.groupId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        if (!group) { socket.emit('error', { message: 'Группа не найдена.' }); return; }
        user.groupId = group.id;
        logAdminAction('move_to_group', user.id, user.name, null, null, `→ ${group.name}`);
        saveDB();
        emitBankUpdate();
    });

    // --- Admin: Set Group Permissions ---
    socket.on('admin:setGroupPermissions', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const groupId = data?.groupId;
        const allowedGroups = Array.isArray(data?.allowedGroups) ? data.allowedGroups : [];
        if (!groupId) { socket.emit('error', { message: 'Укажите группу.' }); return; }
        db.groupPermissions[groupId] = allowedGroups;
        logAdminAction('set_group_permissions', null, null, null, null, `Группа ${groupId} → [${allowedGroups.join(',')}]`);
        saveDB();
        emitBankUpdate();
    });

    // --- Admin: Get Group Permissions ---
    socket.on('admin:getGroupPermissions', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        socket.emit('admin:groupPermissions', { groupPermissions: db.groupPermissions });
    });

    // --- User: Get Group Permissions (for filtering) ---
    socket.on('user:getGroupPermissions', () => {
        socket.emit('admin:groupPermissions', { groupPermissions: db.groupPermissions, groups: getAllGroups() });
    });

    // ==================== INVESTMENT OPERATIONS ====================

    function getInvestmentPrice(type) {
        if (!db.investmentPrices[type]) db.investmentPrices[type] = 10000;
        const dir = Math.random();
        if (dir < 0.5) { db.investmentPrices[type] = Math.round(db.investmentPrices[type] * (1.0 + Math.random() * 0.5)); }
        else { db.investmentPrices[type] = Math.round(db.investmentPrices[type] * (0.7 + Math.random() * 0.3)); }
        db.investmentPrices[type] = Math.max(1000, db.investmentPrices[type]);
        return db.investmentPrices[type];
    }

    function getBTCPrice() {
        const dir = Math.random();
        if (dir < 0.5) { db.btcPrice = Math.round(db.btcPrice * (1.0 + Math.random() * 1.0)); }
        else { db.btcPrice = Math.round(db.btcPrice * (0.5 + Math.random() * 0.5)); }
        db.btcPrice = Math.max(1000000, db.btcPrice);
        return db.btcPrice;
    }

    // --- User: Invest ---
    socket.on('user:invest', (data) => {
        if (denyIfGuestOrMaintenance(socket, 'error')) return;
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const type = data?.type || 'science';
        if (!INVESTMENT_TYPES.find(t => t.id === type)) { socket.emit('error', { message: 'Неизвестный тип инвестиции.' }); return; }
        const amount = Number(data?.amount);
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        if (user.balance < amount) { socket.emit('error', { message: 'Недостаточно средств.' }); return; }
        const price = getInvestmentPrice(type);
        const units = amount / price;
        user.balance -= amount;
        touchUser(user);
        const typeName = INVESTMENT_TYPES.find(t => t.id === type)?.name || type;
        const investment = {
            id: genId(), userId: user.id, amount, units, price, type,
            timestamp: Date.now(), status: 'active'
        };
        db.investments.push(investment);
        const tx = {
            id: genId(), type: 'invest_' + type,
            userId: user.id, userName: user.name,
            amount, timestamp: Date.now(),
            description: 'Инвестиция: ' + typeName,
            oldBalance: user.balance + amount, newBalance: user.balance,
            units, price, investType: type
        };
        db.history.push(tx);
        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('investment:success', { investment });
        emitBankUpdate();
    });

    // --- User: Sell Investment ---
    socket.on('user:sellInvestment', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const investment = db.investments.find(i => i.id === data?.investmentId && i.userId === userId && i.status === 'active');
        if (!investment) { socket.emit('error', { message: 'Инвестиция не найдена.' }); return; }
        const currentPrice = getInvestmentPrice(investment.type);
        const sellAmount = Math.round(investment.units * currentPrice);
        investment.status = 'sold';
        investment.soldAt = Date.now();
        investment.sellPrice = currentPrice;
        investment.sellAmount = sellAmount;
        const oldBalance = user.balance;
        user.balance += sellAmount;
        touchUser(user);
        const typeName = INVESTMENT_TYPES.find(t => t.id === investment.type)?.name || investment.type;
        const tx = {
            id: genId(), type: 'invest_sell_' + investment.type,
            userId: user.id, userName: user.name,
            amount: sellAmount, timestamp: Date.now(),
            description: 'Продажа: ' + typeName,
            oldBalance, newBalance: user.balance,
            profit: sellAmount - investment.amount, investType: investment.type
        };
        db.history.push(tx);
        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('investment:sold', { investment, sellAmount, profit: sellAmount - investment.amount });
        emitBankUpdate();
    });

    // --- User: Get Investments ---
    socket.on('user:getInvestments', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const userInvestments = db.investments.filter(i => i.userId === userId);
        const prices = {};
        INVESTMENT_TYPES.forEach(t => { prices[t.id] = db.investmentPrices[t.id] || 10000; });
        socket.emit('investment:list', { investments: userInvestments, prices, types: INVESTMENT_TYPES });
    });

    // ==================== ADMIN INVESTMENT CONTROL ====================

    socket.on('admin:setInvestmentTrend', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const type = data?.type || 'science';
        const dir = data?.direction;
        const amount = data?.amount ? Number(data.amount) : null;
        if (!db.investmentPrices[type]) db.investmentPrices[type] = 10000;
        if (amount && amount > 0) {
            if (dir === 'up') { db.investmentPrices[type] = Math.round(db.investmentPrices[type] + amount); }
            else if (dir === 'down') { db.investmentPrices[type] = Math.round(Math.max(1000, db.investmentPrices[type] - amount)); }
        } else {
            if (dir === 'up') { db.investmentPrices[type] = Math.round(db.investmentPrices[type] * (1.2 + Math.random() * 0.8)); }
            else if (dir === 'down') { db.investmentPrices[type] = Math.round(db.investmentPrices[type] * (0.5 + Math.random() * 0.3)); }
        }
        db.investmentPrices[type] = Math.max(1000, db.investmentPrices[type]);
        saveDB();
        const typeName = INVESTMENT_TYPES.find(t => t.id === type)?.name || type;
        io.emit('investment:priceUpdate', { type, price: db.investmentPrices[type], typeName });
    });

    // Legacy BTC trend support
    socket.on('admin:setBTCTrend', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const dir = data?.direction;
        const amount = data?.amount ? Number(data.amount) : null;
        if (amount && amount > 0) {
            if (dir === 'up') { db.btcPrice = Math.round(db.btcPrice + amount); }
            else if (dir === 'down') { db.btcPrice = Math.round(Math.max(1000000, db.btcPrice - amount)); }
        } else {
            if (dir === 'up') { db.btcPrice = Math.round(db.btcPrice * (1.2 + Math.random() * 0.8)); }
            else if (dir === 'down') { db.btcPrice = Math.round(db.btcPrice * (0.5 + Math.random() * 0.3)); }
        }
        db.btcPrice = Math.max(1000000, db.btcPrice);
        saveDB();
        io.emit('btc:priceUpdate', { price: db.btcPrice });
    });

    // ==================== VIRTUAL BANKS ====================

    // --- User: Get All Banks ---
    socket.on('bank:getAll', () => {
        const banks = (db.virtualBanks || []).filter(b => b.enabled);
        socket.emit('bank:all', { banks });
    });

    // --- User: Get Deposits ---
    socket.on('bank:getDeposits', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        checkMaturedDeposits(userId);
        const deps = db.userBankDeposits.filter(d => d.userId === userId);
        const invs = db.userBankInvestments.filter(i => i.userId === userId);
        socket.emit('bank:deposits', { deposits: deps, investments: invs });
    });

    // --- User: Get History ---
    socket.on('bank:getHistory', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const hist = db.bankHistory.filter(h => h.userId === userId).sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
        socket.emit('bank:history', { history: hist });
    });

    // --- User: Open Deposit ---
    socket.on('bank:openDeposit', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const bankId = data?.bankId;
        const bank = (db.virtualBanks || []).find(b => b.id === bankId && b.enabled);
        if (!bank) { socket.emit('error', { message: 'Банк не найден.' }); return; }
        const amount = Number(data?.amount);
        const termDays = Number(data?.termDays);
        if (!Number.isInteger(amount) || amount <= 0) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        if (amount < bank.minDeposit || amount > bank.maxDeposit) { socket.emit('error', { message: 'Сумма от ' + bank.minDeposit + ' до ' + bank.maxDeposit + '.' }); return; }
        if (!bank.terms.includes(termDays)) { socket.emit('error', { message: 'Недопустимый срок.' }); return; }
        if (user.balance < amount) { socket.emit('error', { message: 'Недостаточно средств.' }); return; }
        const oldBal = user.balance;
        user.balance -= amount;
        touchUser(user);
        const now = Date.now();
        const income = Math.round(amount * (bank.depositPercent / 100) * (termDays / 30));
        const dep = { id: genId(), userId: user.id, bankId: bank.id, amount, termDays, percent: bank.depositPercent, startDate: now, endDate: now + termDays * 86400000, expectedIncome: income, status: 'active' };
        db.userBankDeposits.push(dep);
        const tx = { id: genId(), type: 'bank_deposit_open', userId: user.id, userName: user.name, amount, timestamp: now, description: 'Депозит в ' + bank.name, oldBalance: oldBal, newBalance: user.balance, bankId: bank.id, depositId: dep.id };
        db.history.push(tx);
        db.bankHistory.push({ id: genId(), userId: user.id, type: 'deposit_open', bankId: bank.id, amount, termDays, percent: bank.depositPercent, expectedIncome: income, timestamp: now });
        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('bank:depositSuccess', { deposit: dep });
        emitBankUpdate();
    });

    // --- User: Invest in Bank ---
    socket.on('bank:invest', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const bankId = data?.bankId;
        const bank = (db.virtualBanks || []).find(b => b.id === bankId && b.enabled);
        if (!bank) { socket.emit('error', { message: 'Банк не найден.' }); return; }
        const amount = Number(data?.amount);
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        if (user.balance < amount) { socket.emit('error', { message: 'Недостаточно средств.' }); return; }
        const oldBal = user.balance;
        user.balance -= amount;
        touchUser(user);
        const units = amount / bank.rate;
        const now = Date.now();
        const inv = { id: genId(), userId: user.id, bankId: bank.id, amount, units, buyRate: bank.rate, timestamp: now, status: 'active' };
        db.userBankInvestments.push(inv);
        const tx = { id: genId(), type: 'bank_invest', userId: user.id, userName: user.name, amount, timestamp: now, description: 'Инвестиция в ' + bank.name, oldBalance: oldBal, newBalance: user.balance, bankId: bank.id, investmentId: inv.id, units, rate: bank.rate };
        db.history.push(tx);
        db.bankHistory.push({ id: genId(), userId: user.id, type: 'invest_buy', bankId: bank.id, amount, units, rate: bank.rate, timestamp: now });
        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('bank:investSuccess', { investment: inv });
        emitBankUpdate();
    });

    // --- User: Sell Bank Investment ---
    socket.on('bank:sellInvestment', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const inv = db.userBankInvestments.find(i => i.id === data?.investmentId && i.userId === userId && i.status === 'active');
        if (!inv) { socket.emit('error', { message: 'Инвестиция не найдена.' }); return; }
        const bank = (db.virtualBanks || []).find(b => b.id === inv.bankId);
        if (!bank) { socket.emit('error', { message: 'Банк не найден.' }); return; }
        const sellAmount = Math.round(inv.units * bank.rate);
        const oldBal = user.balance;
        user.balance += sellAmount;
        touchUser(user);
        inv.status = 'sold';
        inv.soldAt = Date.now();
        inv.sellRate = bank.rate;
        inv.sellAmount = sellAmount;
        const profit = sellAmount - inv.amount;
        const tx = { id: genId(), type: 'bank_invest_sell', userId: user.id, userName: user.name, amount: sellAmount, timestamp: Date.now(), description: 'Продажа инвестиции: ' + bank.name, oldBalance: oldBal, newBalance: user.balance, bankId: bank.id, investmentId: inv.id, profit };
        db.history.push(tx);
        db.bankHistory.push({ id: genId(), userId: user.id, type: 'invest_sell', bankId: bank.id, amount: sellAmount, profit, rate: bank.rate, timestamp: Date.now() });
        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('bank:sellSuccess', { investment: inv, sellAmount, profit });
        emitBankUpdate();
    });

    // ==================== ADMIN: VIRTUAL BANKS ====================

    socket.on('admin:bank:getAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const banks = db.virtualBanks || [];
        const stats = {};
        banks.forEach(b => {
            const deps = db.userBankDeposits.filter(d => d.bankId === b.id && d.status === 'active');
            const invs = db.userBankInvestments.filter(i => i.bankId === b.id && i.status === 'active');
            const userIds = new Set([...deps.map(d => d.userId), ...invs.map(i => i.userId)]);
            stats[b.id] = { totalDeposits: deps.reduce((s, d) => s + d.amount, 0), totalInvestments: invs.reduce((s, i) => s + i.amount, 0), userCount: userIds.size, activeDeposits: deps.length, activeInvestments: invs.length };
        });
        socket.emit('admin:bankData', { banks, stats });
    });

    socket.on('admin:bank:setRate', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const bank = (db.virtualBanks || []).find(b => b.id === data?.bankId);
        if (!bank) { socket.emit('error', { message: 'Банк не найден.' }); return; }
        const rate = Number(data?.rate);
        if (!isFinite(rate) || rate <= 0) { socket.emit('error', { message: 'Некорректный курс.' }); return; }
        bank.prevRate = bank.rate;
        bank.rate = Math.round(rate * 100) / 100;
        bank.rateHistory = bank.rateHistory || [];
        bank.rateHistory.push({ rate: bank.rate, ts: Date.now() });
        if (bank.rateHistory.length > 100) bank.rateHistory = bank.rateHistory.slice(-100);
        saveDB();
        io.emit('bank:rateUpdate', { bankId: bank.id, rate: bank.rate, prevRate: bank.prevRate });
    });

    socket.on('admin:bank:adjustRate', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const bank = (db.virtualBanks || []).find(b => b.id === data?.bankId);
        if (!bank) { socket.emit('error', { message: 'Банк не найден.' }); return; }
        const percent = Number(data?.percent);
        const direction = data?.direction;
        if (!isFinite(percent) || percent <= 0) { socket.emit('error', { message: 'Некорректное значение.' }); return; }
        bank.prevRate = bank.rate;
        if (direction === 'up') bank.rate = Math.round(bank.rate * (1 + percent / 100) * 100) / 100;
        else bank.rate = Math.round(Math.max(1, bank.rate * (1 - percent / 100)) * 100) / 100;
        bank.rateHistory = bank.rateHistory || [];
        bank.rateHistory.push({ rate: bank.rate, ts: Date.now() });
        if (bank.rateHistory.length > 100) bank.rateHistory = bank.rateHistory.slice(-100);
        saveDB();
        io.emit('bank:rateUpdate', { bankId: bank.id, rate: bank.rate, prevRate: bank.prevRate });
    });

    socket.on('admin:bank:update', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const bank = (db.virtualBanks || []).find(b => b.id === data?.bankId);
        if (!bank) { socket.emit('error', { message: 'Банк не найден.' }); return; }
        if (data.name !== undefined) bank.name = String(data.name);
        if (data.description !== undefined) bank.description = String(data.description);
        if (data.icon !== undefined) bank.icon = String(data.icon);
        if (data.color !== undefined) bank.color = String(data.color);
        if (data.depositPercent !== undefined) { const v = Number(data.depositPercent); if (isFinite(v) && v >= 0) bank.depositPercent = v; }
        if (data.minDeposit !== undefined) { const v = Number(data.minDeposit); if (isFinite(v) && v >= 0) bank.minDeposit = v; }
        if (data.maxDeposit !== undefined) { const v = Number(data.maxDeposit); if (isFinite(v) && v >= 0) bank.maxDeposit = v; }
        if (data.terms !== undefined && Array.isArray(data.terms)) bank.terms = data.terms.map(Number).filter(n => n > 0);
        if (data.enabled !== undefined) bank.enabled = !!data.enabled;
        saveDB();
        io.emit('bank:rateUpdate', { bankId: bank.id, rate: bank.rate, prevRate: bank.prevRate });
    });

    // ==================== PURCHASE REQUESTS ====================

    socket.on('user:createPurchase', (data) => {
        if (denyIfGuestOrMaintenance(socket, 'error')) return;
        const userId = socketUserMap.get(socket.id);
        const buyer = findUser(userId);
        if (!buyer) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const amount = Number(data?.amount);
        const reason = (data?.reason || '').trim();
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        if (!reason) { socket.emit('error', { message: 'Опишите покупку.' }); return; }
        if (buyer.balance < amount) { socket.emit('error', { message: 'Недостаточно средств.' }); return; }
        const req = { id: genId(), userId: buyer.id, userName: buyer.name, amount, reason, status: 'pending', createdAt: Date.now(), updatedAt: Date.now() };
        db.purchaseRequests.push(req);
        saveDB();
        socket.emit('purchase:submitted', { request: req });
        for (const sid of adminSockets) { io.to(sid).emit('purchase:newRequest', { request: req }); }
        // Create unified approval request
        createApprovalRequest('purchase', buyer.id, buyer.name, { purchaseRequestId: req.id, reason: req.reason, amount: req.amount });
    });

    socket.on('admin:approvePurchase', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const req = db.purchaseRequests.find(r => r.id === data?.requestId);
        if (!req) { socket.emit('error', { message: 'Заявка не найдена.' }); return; }
        if (req.status !== 'pending' && req.status !== 'repriced') { socket.emit('error', { message: 'Заявка уже обработана.' }); return; }
        const buyer = findUser(req.userId);
        if (!buyer) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const price = req.repricedAmount || req.amount;
        if (buyer.balance < price) { req.status = 'denied_insufficient'; req.updatedAt = Date.now(); saveDB(); socket.emit('error', { message: 'Недостаточно средств у покупателя.' }); return; }
        const oldBalance = buyer.balance;
        buyer.balance -= price;
        touchUser(buyer);
        req.status = 'approved'; req.updatedAt = Date.now(); req.approvedPrice = price;
        const tx = { id: genId(), type: 'purchase', userId: buyer.id, userName: buyer.name, amount: price, timestamp: Date.now(), description: 'Покупка: ' + req.reason, reason: req.reason, oldBalance, newBalance: buyer.balance };
        db.history.push(tx);
        // Sync with approvalRequests
        const approvalReq = db.approvalRequests.find(r => r.type === 'purchase' && r.data?.purchaseRequestId === req.id && r.status === 'pending');
        if (approvalReq) {
            approvalReq.status = 'approved';
            approvalReq.reviewedAt = Date.now();
            approvalReq.adminComment = '';
            emitToUser(req.userId, 'approval:resolved', { requestId: approvalReq.id, status: 'approved', type: 'purchase', comment: '' });
            for (const sid of adminSockets) { io.to(sid).emit('approval:reviewed', { request: approvalReq }); }
        }
        saveDB();
        emitToUser(buyer.id, 'purchase:approved', { request: req, tx });
        emitToUser(buyer.id, 'transaction:new', tx);
        emitBankUpdate();
        // Notify admin of result
        socket.emit('admin:purchaseResult', { request: req, action: 'approved' });
    });

    socket.on('admin:denyPurchase', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const req = db.purchaseRequests.find(r => r.id === data?.requestId);
        if (!req) { socket.emit('error', { message: 'Заявка не найдена.' }); return; }
        if (req.status !== 'pending' && req.status !== 'repriced') { socket.emit('error', { message: 'Заявка уже обработана.' }); return; }
        req.status = 'denied'; req.updatedAt = Date.now();
        // Sync with approvalRequests
        const approvalReq = db.approvalRequests.find(r => r.type === 'purchase' && r.data?.purchaseRequestId === req.id && r.status === 'pending');
        if (approvalReq) {
            approvalReq.status = 'rejected';
            approvalReq.reviewedAt = Date.now();
            approvalReq.adminComment = '';
            emitToUser(req.userId, 'approval:resolved', { requestId: approvalReq.id, status: 'rejected', type: 'purchase', comment: '' });
            for (const sid of adminSockets) { io.to(sid).emit('approval:reviewed', { request: approvalReq }); }
        }
        saveDB();
        emitToUser(req.userId, 'purchase:denied', { request: req });
        // Notify admin of result
        socket.emit('admin:purchaseResult', { request: req, action: 'denied' });
    });

    socket.on('admin:repricePurchase', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const req = db.purchaseRequests.find(r => r.id === data?.requestId);
        if (!req) { socket.emit('error', { message: 'Заявка не найдена.' }); return; }
        const newPrice = Number(data?.newPrice);
        if (!Number.isInteger(newPrice) || newPrice <= 0) { socket.emit('error', { message: 'Некорректная цена.' }); return; }
        req.repricedAmount = newPrice; req.status = 'repriced'; req.updatedAt = Date.now();
        // Sync with approvalRequests - update data with new price info
        const approvalReq = db.approvalRequests.find(r => r.type === 'purchase' && r.data?.purchaseRequestId === req.id && r.status === 'pending');
        if (approvalReq) {
            approvalReq.data.repricedAmount = newPrice;
            for (const sid of adminSockets) { io.to(sid).emit('approval:reviewed', { request: approvalReq }); }
        }
        saveDB();
        emitToUser(req.userId, 'purchase:repriced', { request: req });
        // Notify admin of result
        socket.emit('admin:purchaseResult', { request: req, action: 'repriced' });
    });

    socket.on('user:respondReprice', (data) => {
        const userId = socketUserMap.get(socket.id);
        const buyer = findUser(userId);
        if (!buyer) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const req = db.purchaseRequests.find(r => r.id === data?.requestId && r.userId === userId);
        if (!req) { socket.emit('error', { message: 'Заявка не найдена.' }); return; }
        if (req.status !== 'repriced') { socket.emit('error', { message: 'Заявка не ожидает ответа.' }); return; }
        if (data?.accept) {
            const price = req.repricedAmount;
            if (buyer.balance < price) { req.status = 'denied_insufficient'; req.updatedAt = Date.now(); saveDB(); socket.emit('error', { message: 'Недостаточно средств.' }); return; }
            const oldBalance = buyer.balance;
            buyer.balance -= price;
            touchUser(buyer);
            req.status = 'approved'; req.updatedAt = Date.now(); req.approvedPrice = price;
            const tx = { id: genId(), type: 'purchase', userId: buyer.id, userName: buyer.name, amount: price, timestamp: Date.now(), description: 'Покупка: ' + req.reason, reason: req.reason, oldBalance, newBalance: buyer.balance };
            db.history.push(tx);
            saveDB();
            socket.emit('purchase:approved', { request: req, tx });
            socket.emit('transaction:new', tx);
            emitBankUpdate();
        } else {
            req.status = 'denied'; req.updatedAt = Date.now();
            saveDB();
            socket.emit('purchase:denied', { request: req });
        }
    });

    // ==================== COUPON SYSTEM ====================

    // --- Get Shop Coupons ---
    socket.on('coupon:getShop', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const shopCoupons = db.coupons.filter(c => c.active);
        const myCoupons = db.userCoupons.filter(uc => uc.userId === userId);
        socket.emit('coupon:shop', { coupons: shopCoupons, myCoupons });
    });

    // --- Get My Coupons ---
    socket.on('coupon:getMy', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const myCoupons = db.userCoupons.filter(uc => uc.userId === userId);
        const couponDefs = db.coupons;
        socket.emit('coupon:my', { userCoupons: myCoupons, coupons: couponDefs });
    });

    // --- Buy Coupon ---
    socket.on('coupon:buy', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const couponDef = db.coupons.find(c => c.id === data?.couponId && c.active);
        if (!couponDef) { socket.emit('error', { message: 'Купон не найден.' }); return; }
        if (user.balance < couponDef.price) { socket.emit('error', { message: 'Недостаточно средств.' }); return; }
        const oldBalance = user.balance;
        user.balance -= couponDef.price;
        touchUser(user);
        const userCoupon = {
            id: 'coupon_' + user.id.substring(0, 8) + '_' + Date.now().toString(36),
            couponId: couponDef.id,
            userId: user.id,
            userName: user.name,
            couponName: couponDef.name,
            couponDescription: couponDef.description,
            couponIcon: couponDef.icon,
            couponCategory: couponDef.category,
            price: couponDef.price,
            status: 'active',
            source: 'purchased',
            purchasedAt: Date.now(),
            activatedAt: null,
            expiresAt: Date.now() + couponDef.durationDays * 86400000,
            usedAt: null,
            giftedBy: null,
            giftByName: null
        };
        db.userCoupons.push(userCoupon);
        const tx = {
            id: genId(), type: 'coupon_purchase',
            userId: user.id, userName: user.name,
            amount: couponDef.price, timestamp: Date.now(),
            description: 'Покупка купона: ' + couponDef.name,
            oldBalance, newBalance: user.balance,
            couponId: couponDef.id, userCouponId: userCoupon.id
        };
        db.history.push(tx);
        // Admin notification
        const notif = {
            id: genId(), type: 'coupon_purchased',
            userId: user.id, userName: user.name,
            couponName: couponDef.name, couponId: couponDef.id,
            userCouponId: userCoupon.id,
            amount: couponDef.price,
            timestamp: Date.now(), read: false
        };
        db.couponNotifications.push(notif);
        saveDB();
        socket.emit('coupon:buySuccess', { userCoupon, tx });
        socket.emit('transaction:new', tx);
        emitBankUpdate();
        // Notify admin sockets
        for (const sid of adminSockets) {
            io.to(sid).emit('coupon:adminNotif', notif);
        }
    });

    // --- Activate Coupon ---
    socket.on('coupon:activate', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const uc = db.userCoupons.find(u => u.id === data?.userCouponId && u.userId === userId);
        if (!uc) { socket.emit('error', { message: 'Купон не найден.' }); return; }
        if (uc.status !== 'active') { socket.emit('error', { message: 'Купон уже использован или истёк.' }); return; }
        if (uc.expiresAt && Date.now() > uc.expiresAt) {
            uc.status = 'expired';
            saveDB();
            socket.emit('error', { message: 'Срок действия купона истёк.' });
            socket.emit('coupon:expired', { userCouponId: uc.id });
            return;
        }
        uc.status = 'activated';
        uc.activatedAt = Date.now();
        uc.usedAt = Date.now();
        // Admin notification
        const notif = {
            id: genId(), type: 'coupon_activated',
            userId: user.id, userName: user.name,
            couponName: uc.couponName, couponId: uc.couponId,
            userCouponId: uc.id,
            timestamp: Date.now(), read: false
        };
        db.couponNotifications.push(notif);
        saveDB();
        socket.emit('coupon:activateSuccess', { userCoupon: uc });
        // Notify admin sockets
        for (const sid of adminSockets) {
            io.to(sid).emit('coupon:adminNotif', notif);
        }
        // Send notification to user
        const userNotif = {
            id: genId(),
            targetUserId: user.id,
            title: '🎟️ Купон активирован!',
            text: 'Купон «' + uc.couponName + '» успешно активирован!',
            timestamp: Date.now(),
            read: false,
            senderName: 'Система купонов'
        };
        db.notifications.push(userNotif);
        emitToUser(user.id, 'notification:push', userNotif);
    });

    // --- Check Expired Coupons ---
    socket.on('coupon:checkExpired', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const now = Date.now();
        let changed = false;
        db.userCoupons.forEach(uc => {
            if (uc.userId === userId && uc.status === 'active' && uc.expiresAt && now > uc.expiresAt) {
                uc.status = 'expired';
                changed = true;
            }
        });
        if (changed) saveDB();
        const myCoupons = db.userCoupons.filter(uc => uc.userId === userId);
        const couponDefs = db.coupons;
        socket.emit('coupon:my', { userCoupons: myCoupons, coupons: couponDefs });
    });

    // ==================== ADMIN COUPON OPERATIONS ====================

    // --- Admin: Get All Coupons ---
    socket.on('admin:coupon:getAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        socket.emit('admin:coupon:all', { coupons: db.coupons, userCoupons: db.userCoupons, couponNotifications: db.couponNotifications });
    });

    // --- Admin: Create Coupon ---
    socket.on('admin:coupon:create', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const name = sanitizeName(data?.name);
        const description = (data?.description || '').trim();
        const price = Number(data?.price);
        const category = data?.category || 'easy';
        const icon = data?.icon || '🎟️';
        const durationDays = Number(data?.durationDays) || 7;
        let image = sanitizeImageSrc(data?.image);
        if (!name) { socket.emit('error', { message: 'Введите название купона.' }); return; }
        if (!Number.isInteger(price) || price < 0) { socket.emit('error', { message: 'Некорректная цена.' }); return; }
        const coupon = {
            id: genId(), name, description, price, category, icon, image,
            durationDays, active: true, createdAt: Date.now(),
            sortOrder: db.coupons.length
        };
        db.coupons.push(coupon);
        logAdminAction('coupon_create', null, name, price, null, `Категория: ${category}`);
        saveDB();
        socket.emit('admin:coupon:created', { coupon });
    });

    // --- Admin: Edit Coupon ---
    socket.on('admin:coupon:edit', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const coupon = db.coupons.find(c => c.id === data?.couponId);
        if (!coupon) { socket.emit('error', { message: 'Купон не найден.' }); return; }
        if (data?.name !== undefined) coupon.name = sanitizeName(data.name);
        if (data?.description !== undefined) coupon.description = (data.description || '').trim();
        if (data?.price !== undefined) coupon.price = Number(data.price);
        if (data?.category !== undefined) coupon.category = data.category;
        if (data?.icon !== undefined) coupon.icon = data.icon;
        if (data?.durationDays !== undefined) coupon.durationDays = Number(data.durationDays);
        if (data?.active !== undefined) coupon.active = !!data.active;
        if (data?.image !== undefined) {
            let img = data.image;
            if (img !== undefined) coupon.image = sanitizeImageSrc(img);
            else if (img === null) coupon.image = null;
        }
        logAdminAction('coupon_edit', null, coupon.name, coupon.price, null, null);
        saveDB();
        socket.emit('admin:coupon:edited', { coupon });
    });

    // --- Admin: Toggle Coupon Active ---
    socket.on('admin:coupon:toggle', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const coupon = db.coupons.find(c => c.id === data?.couponId);
        if (!coupon) { socket.emit('error', { message: 'Купон не найден.' }); return; }
        coupon.active = !coupon.active;
        saveDB();
        socket.emit('admin:coupon:toggled', { coupon });
    });

    // --- Admin: Delete Coupon ---
    socket.on('admin:coupon:delete', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const idx = db.coupons.findIndex(c => c.id === data?.couponId);
        if (idx < 0) { socket.emit('error', { message: 'Купон не найден.' }); return; }
        const coupon = db.coupons[idx];
        db.coupons.splice(idx, 1);
        logAdminAction('coupon_delete', null, coupon.name, coupon.price, null, null);
        saveDB();
        socket.emit('admin:coupon:deleted', { couponId: coupon.id });
    });

    // --- Admin: Gift Coupon (free) ---
    socket.on('admin:coupon:gift', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.targetId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const couponDef = db.coupons.find(c => c.id === data?.couponId);
        if (!couponDef) { socket.emit('error', { message: 'Купон не найден.' }); return; }
        const count = Math.max(1, Math.min(100, Number(data?.count) || 1));
        const customDays = data?.durationDays ? Number(data.durationDays) : null;
        const results = [];
        for (let i = 0; i < count; i++) {
            const userCoupon = {
                id: 'coupon_' + target.id.substring(0, 8) + '_' + Date.now().toString(36) + '_' + i,
                couponId: couponDef.id,
                userId: target.id,
                userName: target.name,
                couponName: couponDef.name,
                couponDescription: couponDef.description,
                couponIcon: couponDef.icon,
                couponCategory: couponDef.category,
                price:0,
                status: 'active',
                source: 'gifted',
                purchasedAt: Date.now(),
                activatedAt: null,
                expiresAt: Date.now() + (customDays || couponDef.durationDays) * 86400000,
                usedAt: null,
                giftedBy: 'admin',
                giftByName: 'Администратор'
            };
            db.userCoupons.push(userCoupon);
            results.push(userCoupon);
        }
        const notif = {
            id: genId(), type: 'coupon_gifted',
            userId: target.id, userName: target.name,
            couponName: couponDef.name, couponId: couponDef.id,
            count, timestamp: Date.now(), read: false
        };
        db.couponNotifications.push(notif);
        logAdminAction('coupon_gift', target.id, target.name, 0, couponDef.name, `Подарено ${count} шт.`);
        saveDB();
        socket.emit('admin:coupon:gifted', { results });
        // Notify user
        const userNotif = {
            id: genId(),
            targetUserId: target.id,
            title: '🎁 Подарок — купон!',
            text: 'Администратор подарил вам купон «' + couponDef.name + '»' + (count > 1 ? ' x' + count : '') + '!',
            timestamp: Date.now(),
            read: false,
            senderName: 'Администратор'
        };
        db.notifications.push(userNotif);
        emitToUser(target.id, 'notification:push', userNotif);
        emitToUser(target.id, 'coupon:refresh', {});
    });

    // --- Admin: Issue Coupon for Money ---
    socket.on('admin:coupon:issuePaid', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.targetId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const couponDef = db.coupons.find(c => c.id === data?.couponId);
        if (!couponDef) { socket.emit('error', { message: 'Купон не найден.' }); return; }
        const price = data?.price !== undefined ? Number(data.price) : couponDef.price;
        if (target.balance < price) { socket.emit('error', { message: 'Недостаточно средств у пользователя.' }); return; }
        const oldBalance = target.balance;
        target.balance -= price;
        touchUser(target);
        const userCoupon = {
            id: 'coupon_' + target.id.substring(0, 8) + '_' + Date.now().toString(36),
            couponId: couponDef.id,
            userId: target.id,
            userName: target.name,
            couponName: couponDef.name,
            couponDescription: couponDef.description,
            couponIcon: couponDef.icon,
            couponCategory: couponDef.category,
            price: price,
            status: 'active',
            source: 'admin_paid',
            purchasedAt: Date.now(),
            activatedAt: null,
            expiresAt: Date.now() + couponDef.durationDays * 86400000,
            usedAt: null,
            giftedBy: 'admin',
            giftByName: 'Администратор'
        };
        db.userCoupons.push(userCoupon);
        const tx = {
            id: genId(), type: 'coupon_purchase',
            userId: target.id, userName: target.name,
            amount: price, timestamp: Date.now(),
            description: 'Купон (через админа): ' + couponDef.name,
            oldBalance, newBalance: target.balance,
            couponId: couponDef.id, userCouponId: userCoupon.id
        };
        db.history.push(tx);
        logAdminAction('coupon_issue_paid', target.id, target.name, price, couponDef.name, null);
        saveDB();
        socket.emit('admin:coupon:issuedPaid', { userCoupon, tx });
        emitToUser(target.id, 'transaction:new', tx);
        emitToUser(target.id, 'coupon:refresh', {});
        emitBankUpdate();
    });

    // --- Admin: Revoke Coupon ---
    socket.on('admin:coupon:revoke', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const uc = db.userCoupons.find(u => u.id === data?.userCouponId);
        if (!uc) { socket.emit('error', { message: 'Купон не найден.' }); return; }
        if (uc.status === 'activated' || uc.status === 'used') {
            socket.emit('error', { message: 'Нельзя отозвать уже использованный купон.' }); return;
        }
        uc.status = 'cancelled';
        const notif = {
            id: genId(), type: 'coupon_cancelled',
            userId: uc.userId, userName: uc.userName,
            couponName: uc.couponName, userCouponId: uc.id,
            timestamp: Date.now(), read: false
        };
        db.couponNotifications.push(notif);
        logAdminAction('coupon_revoke', uc.userId, uc.userName, null, uc.couponName, null);
        saveDB();
        socket.emit('admin:coupon:revoked', { userCouponId: uc.id });
        emitToUser(uc.userId, 'coupon:refresh', {});
    });

    // --- Admin: Get Coupon Stats ---
    socket.on('admin:coupon:stats', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const all = db.userCoupons;
        const purchased = all.filter(u => u.source === 'purchased' || u.source === 'admin_paid');
        const gifted = all.filter(u => u.source === 'gifted');
        const activated = all.filter(u => u.status === 'activated' || u.status === 'used');
        const expired = all.filter(u => u.status === 'expired');
        const totalEarned = purchased.reduce((s, u) => s + (u.price || 0), 0);
        // Most popular coupon
        const couponCounts = {};
        all.forEach(u => { couponCounts[u.couponId] = (couponCounts[u.couponId] || 0) + 1; });
        let popularId = null, popularCount = 0;
        for (const [cid, cnt] of Object.entries(couponCounts)) {
            if (cnt > popularCount) { popularId = cid; popularCount = cnt; }
        }
        const popularCoupon = popularId ? db.coupons.find(c => c.id === popularId) : null;
        // Most activated
        const actCounts = {};
        activated.forEach(u => { actCounts[u.couponId] = (actCounts[u.couponId] || 0) + 1; });
        let actPopularId = null, actPopularCount = 0;
        for (const [cid, cnt] of Object.entries(actCounts)) {
            if (cnt > actPopularCount) { actPopularId = cid; actPopularCount = cnt; }
        }
        const actPopularCoupon = actPopularId ? db.coupons.find(c => c.id === actPopularId) : null;
        // Top buyer
        const buyerCounts = {};
        purchased.forEach(u => { buyerCounts[u.userId] = (buyerCounts[u.userId] || 0) + 1; });
        let topBuyerId = null, topBuyerCount = 0;
        for (const [uid, cnt] of Object.entries(buyerCounts)) {
            if (cnt > topBuyerCount) { topBuyerId = uid; topBuyerCount = cnt; }
        }
        const topBuyer = topBuyerId ? findUser(topBuyerId) : null;
        // Most expensive
        const mostExpensive = db.coupons.reduce((max, c) => c.price > (max?.price || 0) ? c : max, null);
        socket.emit('admin:coupon:statsData', {
            totalPurchased: purchased.length,
            totalGifted: gifted.length,
            totalActivated: activated.length,
            totalExpired: expired.length,
            totalEarned,
            popularCoupon: popularCoupon ? popularCoupon.name : '—',
            popularCount,
            mostExpensive: mostExpensive ? mostExpensive.name + ' (' + mostExpensive.price + ' 分)' : '—',
            topBuyer: topBuyer ? topBuyer.name : '—',
            topBuyerCount,
            actPopularCoupon: actPopularCoupon ? actPopularCoupon.name : '—',
            actPopularCount
        });
    });

    // --- Admin: Get User Coupons ---
    socket.on('admin:coupon:getUserCoupons', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const userId = data?.userId;
        const userCoupons = db.userCoupons.filter(uc => uc.userId === userId);
        socket.emit('admin:coupon:userCoupons', { userId, userCoupons });
    });

    // --- Admin: Get Notifications ---
    socket.on('admin:coupon:getNotifs', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        socket.emit('admin:coupon:notifs', { notifications: db.couponNotifications.sort((a, b) => b.timestamp - a.timestamp) });
    });

    // --- Admin: Mark Notif Read ---
    socket.on('admin:coupon:readNotif', (data) => {
        if (!isAdmin(socket.id)) return;
        const n = db.couponNotifications.find(n => n.id === data?.notifId);
        if (n) { n.read = true; saveDB(); }
    });

    // ==================== XP & LEVEL ====================
    socket.on('user:getXP', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const ux = getXP(userId);
        const nextLvlXP = XP_PER_LEVEL[ux.level] || XP_PER_LEVEL[XP_PER_LEVEL.length - 1];
        const prevLvlXP = ux.level > 1 ? (XP_PER_LEVEL[ux.level - 1] || 0) : 0;
        socket.emit('xp:data', { ...ux, nextLevelXP: nextLvlXP, prevLevelXP: prevLvlXP });
    });

    socket.on('user:dailyLogin', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const ux = getXP(userId);
        const today = new Date().toISOString().slice(0, 10);
        if (ux.dailyLoginDate === today) { socket.emit('xp:dailyAlready', {}); return; }
        ux.dailyLoginDate = today;
        saveDB();
        addXP(userId, 10, 'Ежедневный вход');
        socket.emit('xp:dailyLogin', { xp: ux.xp, level: ux.level });
    });

    // ==================== QUESTS ====================
    socket.on('quest:getList', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const userQuests = db.quests.filter(q => q.active || q.isTemplate);
        const mySubmissions = db.quests.filter(q => q.submissions && q.submissions.some(s => s.userId === userId));
        socket.emit('quest:list', { quests: userQuests, mySubmissions });
    });

    socket.on('quest:submit', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const quest = db.quests.find(q => q.id === data?.questId);
        if (!quest) { socket.emit('error', { message: 'Квест не найден.' }); return; }
        if (!quest.submissions) quest.submissions = [];
        const existing = quest.submissions.find(s => s.userId === userId && s.status === 'pending');
        if (existing) { socket.emit('error', { message: 'Вы уже отправили результат на проверку.' }); return; }
        const submission = {
            id: genId(), userId, userName: user.name,
            questId: quest.id, result: (data?.result || '').trim(),
            status: 'pending', submittedAt: Date.now(),
            customReward: null, customXP: null
        };
        quest.submissions.push(submission);
        saveDB();
        socket.emit('quest:submitted', { submission });
        for (const sid of adminSockets) { io.to(sid).emit('quest:newSubmission', { quest, submission }); }
        // Create unified approval request
        createApprovalRequest('quest', user.id, user.name, { questId: quest.id, submissionId: submission.id, questTitle: quest.title, result: submission.result });
    });

    // Admin: Review quest submission
    socket.on('admin:quest:review', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const quest = db.quests.find(q => q.id === data?.questId);
        if (!quest || !quest.submissions) { socket.emit('error', { message: 'Квест не найден.' }); return; }
        const sub = quest.submissions.find(s => s.id === data?.submissionId);
        if (!sub) { socket.emit('error', { message: 'Отправка не найдена.' }); return; }
        const verdict = data?.verdict; // 'completed', 'errors', 'failed'
        sub.status = verdict;
        sub.reviewedAt = Date.now();
        sub.adminComment = (data?.comment || '').trim();
        const target = findUser(sub.userId);
        if (target) {
            if (verdict === 'completed') {
                const reward = sub.customReward ? sub.customReward : quest.reward * 3;
                const xpAmount = sub.customXP ? sub.customXP : quest.xp * 3;
                target.balance += reward;
                touchUser(target);
                const tx = { id: genId(), type: 'quest_reward', userId: target.id, userName: target.name, amount: reward, timestamp: Date.now(), description: 'Квест: ' + quest.title, oldBalance: target.balance - reward, newBalance: target.balance };
                db.history.push(tx);
                addXP(sub.userId, xpAmount, 'Квест: ' + quest.title);
                emitToUser(sub.userId, 'notification:new', { type: 'received', from: 'Квесты', amount: reward, message: 'Награда за квест: ' + quest.title });
                emitToUser(sub.userId, 'quest:reviewed', { questId: quest.id, verdict, reward, xp: xpAmount });
            } else if (verdict === 'errors') {
                const reward = Number(data?.partialReward) || 0;
                const xpAmount = Number(data?.partialXP) || 0;
                if (reward > 0) {
                    target.balance += reward;
                    touchUser(target);
                    const tx = { id: genId(), type: 'quest_reward', userId: target.id, userName: target.name, amount: reward, timestamp: Date.now(), description: 'Квест (с ошибками): ' + quest.title, oldBalance: target.balance - reward, newBalance: target.balance };
                    db.history.push(tx);
                }
                if (xpAmount > 0) addXP(sub.userId, xpAmount, 'Квест (с ошибками): ' + quest.title);
                emitToUser(sub.userId, 'notification:new', { type: 'received', from: 'Квесты', amount: reward, message: 'Квест «' + quest.title + '» — с ошибками. Баллов: ' + reward });
                emitToUser(sub.userId, 'quest:reviewed', { questId: quest.id, verdict, reward, xp: xpAmount });
            } else {
                emitToUser(sub.userId, 'notification:new', { type: 'fine', reason: 'Квест «' + quest.title + '» не выполнен', amount: 0 });
                emitToUser(sub.userId, 'quest:reviewed', { questId: quest.id, verdict, reward: 0, xp: 0 });
            }
        }
        saveDB();
        emitBankUpdate();
        socket.emit('admin:quest:reviewed', { submission: sub });
    });

    // Admin: Create quest
    socket.on('admin:quest:create', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const adminUserId = socketUserMap.get(socket.id);
        const quest = {
            id: genId(), title: sanitizeName(data?.title), description: (data?.description || '').trim(),
            category: data?.category || 'general', difficulty: Number(data?.difficulty) || 1,
            reward: Number(data?.reward) || 50, xp: Number(data?.xp) || 30,
            icon: data?.icon || '🎯', isTemplate: false, active: true,
            createdAt: Date.now(), submissions: [],
            assignedTo: Array.isArray(data?.assignedTo) ? data.assignedTo : [],
            assignedGroup: data?.assignedGroup || null,
            deadline: data?.deadline || null,
            isAdminCreated: true, createdBy: adminUserId,
            durationMinutes: Number(data?.durationMinutes) || null
        };
        if (!quest.title) { socket.emit('error', { message: 'Введите название.' }); return; }
        db.quests.push(quest);
        logAdminAction('quest_create', null, quest.title, quest.reward, null, null);
        saveDB();
        socket.emit('admin:quest:created', { quest });
        // Notify assigned users with enhanced notification
        quest.assignedTo.forEach(uid => emitToUser(uid, 'notification:push', {
            id: genId(), targetUserId: uid,
            title: quest.title,
            text: quest.description || 'Новый квест от учителя',
            timestamp: Date.now(), read: false, senderName: 'Администратор',
            type: 'quest_assigned',
            reward: quest.reward, xp: quest.xp,
            duration: quest.durationMinutes,
            questId: quest.id
        }));
    });

    // Admin: Get all quests
    socket.on('admin:quest:getAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        socket.emit('admin:quest:all', { quests: db.quests });
    });

    // Admin: Edit quest
    socket.on('admin:quest:edit', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const quest = db.quests.find(q => q.id === data?.questId);
        if (!quest) { socket.emit('error', { message: 'Квест не найден.' }); return; }
        if (data?.title !== undefined) quest.title = sanitizeName(data.title);
        if (data?.description !== undefined) quest.description = (data.description || '').trim();
        if (data?.reward !== undefined) quest.reward = Number(data.reward);
        if (data?.xp !== undefined) quest.xp = Number(data.xp);
        if (data?.difficulty !== undefined) quest.difficulty = Number(data.difficulty);
        if (data?.icon !== undefined) quest.icon = data.icon;
        if (data?.category !== undefined) quest.category = data.category;
        if (data?.assignedTo !== undefined) quest.assignedTo = Array.isArray(data.assignedTo) ? data.assignedTo : [];
        if (data?.active !== undefined) quest.active = !!data.active;
        logAdminAction('quest_edit', null, quest.title, quest.reward, null, null);
        saveDB();
        socket.emit('admin:quest:edited', { quest });
    });

    // Admin: Delete quest
    socket.on('admin:quest:delete', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const quest = db.quests.find(q => q.id === data?.questId);
        if (!quest) { socket.emit('error', { message: 'Квест не найден.' }); return; }
        const title = quest.title;
        db.quests = db.quests.filter(q => q.id !== data.questId);
        logAdminAction('quest_delete', null, title, null, null, null);
        saveDB();
        socket.emit('admin:quest:deleted', { questId: data.questId });
    });

    // Admin: Clear all pending quest submissions
    socket.on('admin:quest:clearAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        let count = 0;
        db.quests.forEach(q => {
            if (q.submissions) {
                const pending = q.submissions.filter(s => s.status === 'pending');
                pending.forEach(s => {
                    s.status = 'failed';
                    s.reviewedAt = Date.now();
                    s.adminComment = 'Очищено администратором';
                    emitToUser(s.userId, 'quest:reviewed', { questId: q.id, verdict: 'failed', reward: 0, xp: 0 });
                    count++;
                });
            }
        });
        logAdminAction('quest_clear_all', null, null, null, null, `Очищено ${count} отправок`);
        saveDB();
        emitBankUpdate();
        socket.emit('admin:quest:cleared', { count });
    });

    // ==================== TASKS ====================
    socket.on('task:getList', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const user = findUser(userId);
        const myTasks = db.taskAssignments.filter(t => {
            if (t.isTemplate) return true;
            if (t.assignedTo && t.assignedTo.includes(userId)) return true;
            if (t.assignedGroup && user && user.groupId === t.assignedGroup) return true;
            return false;
        });
        socket.emit('task:list', { tasks: myTasks });
    });

    socket.on('task:submit', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const task = db.taskAssignments.find(t => t.id === data?.taskId);
        if (!task) { socket.emit('error', { message: 'Задание не найдено.' }); return; }
        if (!task.submissions) task.submissions = [];
        const existing = task.submissions.find(s => s.userId === userId && s.status === 'pending');
        if (existing) { socket.emit('error', { message: 'Вы уже отправили результат.' }); return; }
        const submission = {
            id: genId(), userId, userName: user.name,
            taskId: task.id, result: (data?.result || '').trim(),
            status: 'pending', submittedAt: Date.now(),
            customReward: null, customXP: null
        };
        task.submissions.push(submission);
        saveDB();
        socket.emit('task:submitted', { submission });
        for (const sid of adminSockets) { io.to(sid).emit('task:newSubmission', { task, submission }); }
        // Create unified approval request
        createApprovalRequest('task', user.id, user.name, { taskId: task.id, submissionId: submission.id, taskTitle: task.title, result: submission.result });
    });

    // Admin: Review task submission
    socket.on('admin:task:review', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const task = db.taskAssignments.find(t => t.id === data?.taskId);
        if (!task || !task.submissions) { socket.emit('error', { message: 'Задание не найдено.' }); return; }
        const sub = task.submissions.find(s => s.id === data?.submissionId);
        if (!sub) { socket.emit('error', { message: 'Отправка не найдена.' }); return; }
        const verdict = data?.verdict;
        sub.status = verdict;
        sub.reviewedAt = Date.now();
        sub.adminComment = (data?.comment || '').trim();
        const target = findUser(sub.userId);
        if (target) {
            if (verdict === 'completed') {
                const reward = sub.customReward ? sub.customReward : task.reward * 3;
                const xpAmount = sub.customXP ? sub.customXP : task.xp * 3;
                target.balance += reward; touchUser(target);
                const tx = { id: genId(), type: 'task_reward', userId: target.id, userName: target.name, amount: reward, timestamp: Date.now(), description: 'Задание: ' + task.title, oldBalance: target.balance - reward, newBalance: target.balance };
                db.history.push(tx);
                addXP(sub.userId, xpAmount, 'Задание: ' + task.title);
                emitToUser(sub.userId, 'notification:new', { type: 'received', from: 'Задания', amount: reward, message: 'Награда за задание: ' + task.title });
                emitToUser(sub.userId, 'task:reviewed', { taskId: task.id, verdict, reward, xp: xpAmount });
            } else if (verdict === 'errors') {
                const reward = Number(data?.partialReward) || 0;
                const xpAmount = Number(data?.partialXP) || 0;
                if (reward > 0) { target.balance += reward; touchUser(target); const tx = { id: genId(), type: 'task_reward', userId: target.id, userName: target.name, amount: reward, timestamp: Date.now(), description: 'Задание (с ошибками): ' + task.title, oldBalance: target.balance - reward, newBalance: target.balance }; db.history.push(tx); }
                if (xpAmount > 0) addXP(sub.userId, xpAmount, 'Задание (с ошибками): ' + task.title);
                emitToUser(sub.userId, 'notification:new', { type: 'received', from: 'Задания', amount: reward, message: 'Задание «' + task.title + '» — с ошибками. Баллов: ' + reward });
                emitToUser(sub.userId, 'task:reviewed', { taskId: task.id, verdict, reward, xp: xpAmount });
            } else {
                emitToUser(sub.userId, 'notification:new', { type: 'fine', reason: 'Задание «' + task.title + '» не выполнено', amount: 0 });
                emitToUser(sub.userId, 'task:reviewed', { taskId: task.id, verdict, reward: 0, xp: 0 });
            }
        }
        saveDB(); emitBankUpdate();
        socket.emit('admin:task:reviewed', { submission: sub });
    });

    // Admin: Create task
    socket.on('admin:task:create', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const adminUserId = socketUserMap.get(socket.id);
        const task = {
            id: genId(), title: sanitizeName(data?.title), description: (data?.description || '').trim(),
            category: data?.category || 'general', difficulty: Number(data?.difficulty) || 1,
            reward: Number(data?.reward) || 50, xp: Number(data?.xp) || 30,
            icon: data?.icon || '📋', isTemplate: false, active: true,
            createdAt: Date.now(), submissions: [],
            assignedTo: Array.isArray(data?.assignedTo) ? data.assignedTo : [],
            assignedGroup: data?.assignedGroup || null,
            deadline: data?.deadline || null,
            isAdminCreated: true, createdBy: adminUserId,
            durationMinutes: Number(data?.durationMinutes) || null
        };
        if (!task.title) { socket.emit('error', { message: 'Введите название.' }); return; }
        db.taskAssignments.push(task);
        logAdminAction('task_create', null, task.title, task.reward, null, null);
        saveDB();
        socket.emit('admin:task:created', { task });
        // Notify assigned users with enhanced notification
        task.assignedTo.forEach(uid => emitToUser(uid, 'notification:push', {
            id: genId(), targetUserId: uid,
            title: task.title,
            text: task.description || 'Новое задание от учителя',
            timestamp: Date.now(), read: false, senderName: 'Администратор',
            type: 'task_assigned',
            reward: task.reward, xp: task.xp,
            duration: task.durationMinutes,
            taskId: task.id
        }));
    });

    // Admin: Get all tasks
    socket.on('admin:task:getAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        socket.emit('admin:task:all', { tasks: db.taskAssignments });
    });

    // Admin: Edit task
    socket.on('admin:task:edit', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const task = db.taskAssignments.find(t => t.id === data?.taskId);
        if (!task) { socket.emit('error', { message: 'Задание не найдено.' }); return; }
        if (data?.title !== undefined) task.title = sanitizeName(data.title);
        if (data?.description !== undefined) task.description = (data.description || '').trim();
        if (data?.reward !== undefined) task.reward = Number(data.reward);
        if (data?.xp !== undefined) task.xp = Number(data.xp);
        if (data?.difficulty !== undefined) task.difficulty = Number(data.difficulty);
        if (data?.icon !== undefined) task.icon = data.icon;
        if (data?.category !== undefined) task.category = data.category;
        if (data?.assignedTo !== undefined) task.assignedTo = Array.isArray(data.assignedTo) ? data.assignedTo : [];
        if (data?.active !== undefined) task.active = !!data.active;
        logAdminAction('task_edit', null, task.title, task.reward, null, null);
        saveDB();
        socket.emit('admin:task:edited', { task });
    });

    // Admin: Delete task
    socket.on('admin:task:delete', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const task = db.taskAssignments.find(t => t.id === data?.taskId);
        if (!task) { socket.emit('error', { message: 'Задание не найдено.' }); return; }
        const title = task.title;
        db.taskAssignments = db.taskAssignments.filter(t => t.id !== data.taskId);
        logAdminAction('task_delete', null, title, null, null, null);
        saveDB();
        socket.emit('admin:task:deleted', { taskId: data.taskId });
    });

    // Admin: Clear all pending task submissions
    socket.on('admin:task:clearAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        let count = 0;
        db.taskAssignments.forEach(t => {
            if (t.submissions) {
                const pending = t.submissions.filter(s => s.status === 'pending');
                pending.forEach(s => {
                    s.status = 'failed';
                    s.reviewedAt = Date.now();
                    s.adminComment = 'Очищено администратором';
                    emitToUser(s.userId, 'task:reviewed', { taskId: t.id, verdict: 'failed', reward: 0, xp: 0 });
                    count++;
                });
            }
        });
        logAdminAction('task_clear_all', null, null, null, null, `Очищено ${count} отправок`);
        saveDB();
        emitBankUpdate();
        socket.emit('admin:task:cleared', { count });
    });

    // ==================== PROMOCODES ====================

    // --- User: Get Promo List ---
    socket.on('promo:getList', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const now = Date.now();
        const activePromos = db.promocodes.filter(p => p.status === 'active' && p.endAt > now);
        const myActivations = db.userPromoActivations.filter(a => a.userId === userId);
        const safePromos = activePromos.map(p => ({
            id: p.id, name: p.name,
            rewardType: p.rewardType || 'percent',
            bonusPercent: p.bonusPercent,
            fixedAmount: p.fixedAmount || 0,
            startAt: p.startAt, endAt: p.endAt, status: p.status,
            maxUses: p.maxUses, currentUses: p.currentUses,
            activated: myActivations.some(a => a.promoId === p.id)
        }));
        socket.emit('promo:list', { promos: safePromos, myActivations });
    });

    // --- User: Activate Promo ---
    socket.on('promo:activate', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const promo = db.promocodes.find(p => p.id === data?.promoId);
        if (!promo) { socket.emit('promo:result', { success: false, error: 'not_found', message: 'Промокод не найден.' }); return; }
        if (promo.status !== 'active') { socket.emit('promo:result', { success: false, error: 'disabled', message: 'Промокод отключён.' }); return; }
        const now = Date.now();
        if (now < promo.startAt) { socket.emit('promo:result', { success: false, error: 'not_started', message: 'Промокод ещё не активен.' }); return; }
        if (now > promo.endAt) { socket.emit('promo:result', { success: false, error: 'expired', message: 'Срок действия промокода истёк.' }); return; }
        const code = (data?.code || '').trim().toUpperCase();
        if (!code || code !== promo.secretCode.toUpperCase()) {
            socket.emit('promo:result', { success: false, error: 'wrong_code', message: 'Неверный промокод.' });
            return;
        }
        const alreadyUsed = db.userPromoActivations.find(a => a.promoId === promo.id && a.userId === userId);
        if (alreadyUsed) { socket.emit('promo:result', { success: false, error: 'already_used', message: 'Этот промокод уже был использован.' }); return; }
        if (promo.maxUses !== null && promo.maxUses > 0 && promo.currentUses >= promo.maxUses) {
            socket.emit('promo:result', { success: false, error: 'max_uses', message: 'Достигнут лимит использований.' });
            return;
        }
        const oldBalance = user.balance;
        const isFixed = promo.rewardType === 'fixed';
        const bonusAmount = isFixed ? promo.fixedAmount : Math.floor(user.balance * promo.bonusPercent / 100);
        user.balance += bonusAmount;
        touchUser(user);
        promo.currentUses = (promo.currentUses || 0) + 1;
        const activation = {
            id: genId(), promoId: promo.id, userId: user.id, userName: user.name,
            rewardType: promo.rewardType || 'percent',
            bonusPercent: promo.bonusPercent, fixedAmount: promo.fixedAmount || 0,
            bonusAmount,
            oldBalance, newBalance: user.balance, activatedAt: Date.now()
        };
        db.userPromoActivations.push(activation);
        const tx = {
            id: genId(), type: 'promo_bonus',
            userId: user.id, userName: user.name,
            amount: bonusAmount, timestamp: Date.now(),
            description: 'Промокод: ' + promo.name + (isFixed ? ' (+' + promo.fixedAmount + ' фикс.)' : ' (+' + promo.bonusPercent + '%)'),
            oldBalance, newBalance: user.balance
        };
        db.history.push(tx);
        saveDB();
        socket.emit('promo:result', {
            success: true, message: 'Промокод успешно активирован!',
            rewardType: promo.rewardType || 'percent',
            bonusPercent: promo.bonusPercent, fixedAmount: promo.fixedAmount || 0,
            bonusAmount,
            newBalance: user.balance
        });
        socket.emit('transaction:new', tx);
        emitBankUpdate();
    });

    // ==================== ADMIN PROMOCODES ====================

    // --- Admin: Get All Promos ---
    socket.on('admin:promo:getAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const promosWithStats = db.promocodes.map(p => ({
            ...p,
            activations: db.userPromoActivations.filter(a => a.promoId === p.id)
        }));
        socket.emit('admin:promo:all', { promocodes: promosWithStats });
    });

    // --- Admin: Create Promo ---
    socket.on('admin:promo:create', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const name = sanitizeName(data?.name);
        const secretCode = (data?.secretCode || '').trim().toUpperCase();
        const rewardType = data?.rewardType === 'fixed' ? 'fixed' : 'percent';
        const bonusPercent = rewardType === 'percent' ? Number(data?.bonusPercent) : 0;
        const fixedAmount = rewardType === 'fixed' ? Number(data?.fixedAmount) : 0;
        const startAt = Number(data?.startAt);
        const endAt = Number(data?.endAt);
        const maxUses = data?.maxUses !== undefined && data?.maxUses !== null && data?.maxUses !== '' ? Number(data.maxUses) : null;
        if (!name) { socket.emit('error', { message: 'Введите название.' }); return; }
        if (!secretCode) { socket.emit('error', { message: 'Введите промокод.' }); return; }
        if (rewardType === 'percent') {
            if (!Number.isFinite(bonusPercent) || bonusPercent <= 0 || bonusPercent > 1000) { socket.emit('error', { message: 'Некорректный процент бонуса.' }); return; }
        } else {
            if (!Number.isFinite(fixedAmount) || fixedAmount <= 0 || fixedAmount > 10000000) { socket.emit('error', { message: 'Некорректное количество баллов.' }); return; }
        }
        if (!startAt || !endAt || endAt <= startAt) { socket.emit('error', { message: 'Некорректные даты.' }); return; }
        const promo = {
            id: genId(), name, secretCode, rewardType,
            bonusPercent: rewardType === 'percent' ? bonusPercent : 0,
            fixedAmount: rewardType === 'fixed' ? fixedAmount : 0,
            startAt, endAt, status: 'active',
            maxUses: (maxUses && maxUses > 0) ? maxUses : null,
            currentUses: 0, createdAt: Date.now()
        };
        db.promocodes.push(promo);
        logAdminAction('promo_create', null, name, rewardType === 'fixed' ? fixedAmount : bonusPercent, secretCode, rewardType);
        saveDB();
        socket.emit('admin:promo:created', { promo });
    });

    // --- Admin: Edit Promo ---
    socket.on('admin:promo:edit', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const promo = db.promocodes.find(p => p.id === data?.promoId);
        if (!promo) { socket.emit('error', { message: 'Промокод не найден.' }); return; }
        if (data?.name !== undefined) promo.name = sanitizeName(data.name);
        if (data?.secretCode !== undefined) promo.secretCode = (data.secretCode || '').trim().toUpperCase();
        if (data?.rewardType !== undefined) promo.rewardType = data.rewardType === 'fixed' ? 'fixed' : 'percent';
        if (data?.bonusPercent !== undefined) promo.bonusPercent = Number(data.bonusPercent);
        if (data?.fixedAmount !== undefined) promo.fixedAmount = Number(data.fixedAmount);
        if (data?.startAt !== undefined) promo.startAt = Number(data.startAt);
        if (data?.endAt !== undefined) promo.endAt = Number(data.endAt);
        if (data?.maxUses !== undefined) {
            const mu = data.maxUses !== null && data.maxUses !== '' ? Number(data.maxUses) : null;
            promo.maxUses = (mu && mu > 0) ? mu : null;
        }
        logAdminAction('promo_edit', null, promo.name, promo.rewardType === 'fixed' ? promo.fixedAmount : promo.bonusPercent, null, promo.rewardType || 'percent');
        saveDB();
        socket.emit('admin:promo:edited', { promo });
    });

    // --- Admin: Toggle Promo ---
    socket.on('admin:promo:toggle', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const promo = db.promocodes.find(p => p.id === data?.promoId);
        if (!promo) { socket.emit('error', { message: 'Промокод не найден.' }); return; }
        promo.status = promo.status === 'active' ? 'disabled' : 'active';
        saveDB();
        socket.emit('admin:promo:toggled', { promo });
    });

    // --- Admin: Delete Promo ---
    socket.on('admin:promo:delete', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const idx = db.promocodes.findIndex(p => p.id === data?.promoId);
        if (idx < 0) { socket.emit('error', { message: 'Промокод не найден.' }); return; }
        const promo = db.promocodes[idx];
        db.promocodes.splice(idx, 1);
        logAdminAction('promo_delete', null, promo.name, null, null, null);
        saveDB();
        socket.emit('admin:promo:deleted', { promoId: promo.id });
    });

    // ==================== DUELS ====================
    socket.on('duel:getList', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const myDuels = db.duels.filter(d => d.participants.some(p => p.userId === userId));
        socket.emit('duel:list', { duels: myDuels });
    });

    socket.on('duel:accept', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const block = isUserBlocked(userId);
        if (block) { socket.emit('error', { message: 'Ваш аккаунт заблокирован. ' + (block.reason || ''), code: 'USER_BLOCKED' }); return; }
        const duel = db.duels.find(d => d.id === data?.duelId);
        if (!duel) { socket.emit('error', { message: 'Дуэль не найдена.' }); return; }
        const p = duel.participants.find(p => p.userId === userId);
        if (!p) { socket.emit('error', { message: 'Вы не участник.' }); return; }
        if (p.accepted !== null) { socket.emit('error', { message: 'Вы уже ответили.' }); return; }
        p.accepted = true;
        p.acceptedAt = Date.now();
        // Check if all accepted
        const allAccepted = duel.participants.every(p => p.accepted === true);
        const anyDeclined = duel.participants.some(p => p.accepted === false);
        if (allAccepted) {
            duel.status = 'active';
            duel.startedAt = Date.now();
            duel.endsAt = Date.now() + (duel.durationSeconds || 120) * 1000;
            duel.participants.forEach(p => { p.score = 0; });
            duel.participants.forEach(p => emitToUser(p.userId, 'duel:started', { duel }));
            // Auto-finish when timer expires
            setTimeout(() => {
                if (duel.status === 'active') finishDuel(duel);
            }, (duel.durationSeconds || 120) * 1000 + 500);
        }
        if (anyDeclined) {
            duel.status = 'cancelled';
            duel.participants.filter(p => p.accepted !== false).forEach(p => {
                emitToUser(p.userId, 'duel:cancelled', { duelId: duel.id, reason: 'Один из участников отказался' });
            });
        }
        saveDB();
        socket.emit('duel:accepted', { duel });
    });

    socket.on('duel:decline', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const duel = db.duels.find(d => d.id === data?.duelId);
        if (!duel) return;
        const p = duel.participants.find(p => p.userId === userId);
        if (p) p.accepted = false;
        duel.status = 'cancelled';
        duel.participants.filter(pp => pp.userId !== userId).forEach(pp => {
            emitToUser(pp.userId, 'duel:cancelled', { duelId: duel.id, reason: findUser(userId)?.name + ' отказался' });
        });
        saveDB();
        socket.emit('duel:declined', { duel });
    });

    function finishDuel(duel) {
        if (duel.status !== 'active') return;
        duel.status = 'review';
        duel.finishedAt = Date.now();
        duel.participants.forEach(p => {
            emitToUser(p.userId, 'duel:review', { duelId: duel.id, title: duel.title });
        });
        saveDB();
        // Notify all admin sockets
        for (const sid of adminSockets) {
            io.to(sid).emit('duel:needsReview', { duel });
        }
        // Create unified approval request for the first participant (represents the whole duel)
        const firstParticipant = duel.participants[0];
        if (firstParticipant) {
            createApprovalRequest('duel', firstParticipant.userId, firstParticipant.userName, {
                duelId: duel.id,
                duelTitle: duel.title,
                participants: duel.participants.map(p => ({ userId: p.userId, userName: p.userName, score: p.score }))
            });
        }
    }

    // Admin: Review and finalize duel
    socket.on('admin:duel:review', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const duel = db.duels.find(d => d.id === data?.duelId);
        if (!duel) { socket.emit('error', { message: 'Дуэль не найдена.' }); return; }
        if (duel.status !== 'review' && duel.status !== 'finished') { socket.emit('error', { message: 'Дуэль не ожидает проверки.' }); return; }
        if (duel.reviewedAt) { socket.emit('error', { message: 'Дуэль уже проверена.' }); return; }
        const winnerIds = Array.isArray(data?.winnerIds) ? data.winnerIds : duel.participants.map(p => p.userId);
        const customReward = data?.customReward ? Number(data.customReward) : null;
        const customXP = data?.customXP ? Number(data.customXP) : null;
        duel.status = 'finished';
        duel.reviewedAt = Date.now();
        duel.winnerIds = winnerIds;
        duel.participants.forEach(p => {
            const user = findUser(p.userId);
            if (!user) return;
            const isWinner = winnerIds.includes(p.userId);
            const reward = isWinner ? (customReward || duel.reward) : Math.round((customReward || duel.reward) * 0.3);
            const xpAmount = isWinner ? (customXP || duel.xp) : Math.round((customXP || duel.xp) * 0.3);
            user.balance += reward; touchUser(user);
            const tx = { id: genId(), type: 'duel_reward', userId: user.id, userName: user.name, amount: reward, timestamp: Date.now(), description: 'Дуэль: ' + duel.title + (isWinner ? ' (победа)' : ' (участие)'), oldBalance: user.balance - reward, newBalance: user.balance };
            db.history.push(tx);
            addXP(p.userId, xpAmount, 'Дуэль: ' + duel.title);
            emitToUser(p.userId, 'duel:finished', { duel, isWinner, reward, xp: xpAmount });
        });
        logAdminAction('duel_review', null, duel.title, null, null, `Победители: ${winnerIds.map(id => findUser(id)?.name || id).join(', ')}`);
        saveDB(); emitBankUpdate();
        socket.emit('admin:duel:reviewed', { duel });
    });

    // Admin: Create duel
    socket.on('admin:duel:create', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const participantIds = Array.isArray(data?.participantIds) ? data.participantIds : [];
        if (participantIds.length < 2) { socket.emit('error', { message: 'Нужно минимум 2 участника.' }); return; }
        const duel = {
            id: genId(), title: sanitizeName(data?.title) || 'Дуэль',
            description: (data?.description || '').trim(),
            rules: (data?.rules || '').trim(),
            participants: participantIds.map(uid => ({ userId: uid, userName: findUser(uid)?.name || uid, accepted: null, score: 0 })),
            reward: Number(data?.reward) || 100, xp: Number(data?.xp) || 60,
            durationSeconds: Number(data?.durationSeconds) || 120,
            status: 'pending', createdAt: Date.now(),
            startedAt: null, endsAt: null, finishedAt: null,
            winnerIds: []
        };
        if (!duel.title) { socket.emit('error', { message: 'Введите название.' }); return; }
        db.duels.push(duel);
        logAdminAction('duel_create', null, duel.title, duel.reward, null, participantIds.length + ' участников');
        saveDB();
        socket.emit('admin:duel:created', { duel });
        // Notify participants
        duel.participants.forEach(p => {
            emitToUser(p.userId, 'notification:push', { id: genId(), targetUserId: p.userId, title: '⚔️ Вызваны на дуэль!', text: duel.title + ' — Примите или откажитесь', timestamp: Date.now(), read: false, senderName: 'Администратор' });
            emitToUser(p.userId, 'duel:challenge', { duel });
        });
    });

    // Admin: Get all duels
    socket.on('admin:duel:getAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        socket.emit('admin:duel:all', { duels: db.duels });
    });

    // Admin: Clear all unreviewed duels (auto-finish with all winners)
    socket.on('admin:duel:clearAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        let count = 0;
        db.duels.forEach(duel => {
            if (duel.status === 'review' || (duel.status === 'finished' && !duel.reviewedAt)) {
                duel.status = 'finished';
                duel.reviewedAt = Date.now();
                duel.winnerIds = duel.participants.map(p => p.userId);
                duel.participants.forEach(p => {
                    const user = findUser(p.userId);
                    if (!user) return;
                    const reward = duel.reward;
                    const xpAmount = duel.xp;
                    user.balance += reward; touchUser(user);
                    const tx = { id: genId(), type: 'duel_reward', userId: user.id, userName: user.name, amount: reward, timestamp: Date.now(), description: 'Дуэль: ' + duel.title + ' (авто-очистка)', oldBalance: user.balance - reward, newBalance: user.balance };
                    db.history.push(tx);
                    addXP(p.userId, xpAmount, 'Дуэль: ' + duel.title);
                    emitToUser(p.userId, 'duel:finished', { duel, isWinner: true, reward, xp: xpAmount });
                });
                count++;
            }
        });
        logAdminAction('duel_clear_all', null, null, null, null, `Очищено ${count} дуэлей`);
        saveDB();
        emitBankUpdate();
        socket.emit('admin:duel:cleared', { count });
    });

    // Admin: Finish all active duels
    socket.on('admin:duel:finishAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        let count = 0;
        db.duels.forEach(duel => {
            if (duel.status === 'pending' || duel.status === 'active' || duel.status === 'review') {
                if (duel.status === 'active') finishDuel(duel);
                duel.status = 'finished';
                duel.finishedAt = duel.finishedAt || Date.now();
                duel.reviewedAt = duel.reviewedAt || Date.now();
                if (!duel.winnerIds || !duel.winnerIds.length) {
                    duel.winnerIds = duel.participants.map(p => p.userId);
                }
                duel.participants.forEach(p => {
                    const user = findUser(p.userId);
                    if (user) {
                        const reward = duel.reward;
                        user.balance += reward; touchUser(user);
                        db.history.push({ id: genId(), type: 'duel_reward', userId: user.id, userName: user.name, amount: reward, timestamp: Date.now(), description: 'Дуэль: ' + duel.title + ' (завершено администратором)', oldBalance: user.balance - reward, newBalance: user.balance });
                        addXP(p.userId, duel.xp, 'Дуэль: ' + duel.title);
                        emitToUser(p.userId, 'duel:finished', { duel, isWinner: true, reward, xp: duel.xp });
                    }
                });
                count++;
            }
        });
        logAdminAction('duel_finish_all', null, null, null, null, `Завершено ${count} дуэлей`);
        saveDB(); emitBankUpdate();
        socket.emit('admin:duel:finishedAll', { count });
    });

    // Admin: Finish selected duels
    socket.on('admin:duel:finishSelected', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const ids = Array.isArray(data?.duelIds) ? data.duelIds : [];
        let count = 0;
        ids.forEach(id => {
            const duel = db.duels.find(d => d.id === id);
            if (duel && (duel.status === 'pending' || duel.status === 'active' || duel.status === 'review')) {
                if (duel.status === 'active') finishDuel(duel);
                duel.status = 'finished';
                duel.finishedAt = duel.finishedAt || Date.now();
                duel.reviewedAt = duel.reviewedAt || Date.now();
                if (!duel.winnerIds || !duel.winnerIds.length) {
                    duel.winnerIds = duel.participants.map(p => p.userId);
                }
                duel.participants.forEach(p => {
                    const user = findUser(p.userId);
                    if (user) {
                        const reward = duel.reward;
                        user.balance += reward; touchUser(user);
                        db.history.push({ id: genId(), type: 'duel_reward', userId: user.id, userName: user.name, amount: reward, timestamp: Date.now(), description: 'Дуэль: ' + duel.title + ' (завершено администратором)', oldBalance: user.balance - reward, newBalance: user.balance });
                        addXP(p.userId, duel.xp, 'Дуэль: ' + duel.title);
                        emitToUser(p.userId, 'duel:finished', { duel, isWinner: true, reward, xp: duel.xp });
                    }
                });
                count++;
            }
        });
        logAdminAction('duel_finish_selected', null, null, null, null, `Завершено ${count} дуэлей`);
        saveDB(); emitBankUpdate();
        socket.emit('admin:duel:finishedSelected', { count });
    });

    // Admin: Complete all quests (mark all pending submissions as failed, deactivate templates)
    socket.on('admin:quest:completeAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        let count = 0;
        db.quests.forEach(q => {
            if (q.submissions) {
                q.submissions.filter(s => s.status === 'pending').forEach(s => {
                    s.status = 'failed';
                    s.reviewedAt = Date.now();
                    s.adminComment = 'Завершено администратором';
                    emitToUser(s.userId, 'quest:reviewed', { questId: q.id, verdict: 'failed', reward: 0, xp: 0 });
                    count++;
                });
            }
            q.active = false;
        });
        logAdminAction('quest_complete_all', null, null, null, null, `Завершено ${count} отправок квестов`);
        saveDB(); emitBankUpdate();
        socket.emit('admin:quest:completedAll', { count });
    });

    // Admin: Complete selected quests
    socket.on('admin:quest:completeSelected', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const ids = Array.isArray(data?.questIds) ? data.questIds : [];
        let count = 0;
        ids.forEach(id => {
            const q = db.quests.find(x => x.id === id);
            if (q) {
                if (q.submissions) {
                    q.submissions.filter(s => s.status === 'pending').forEach(s => {
                        s.status = 'failed';
                        s.reviewedAt = Date.now();
                        s.adminComment = 'Завершено администратором';
                        emitToUser(s.userId, 'quest:reviewed', { questId: q.id, verdict: 'failed', reward: 0, xp: 0 });
                        count++;
                    });
                }
                q.active = false;
            }
        });
        logAdminAction('quest_complete_selected', null, null, null, null, `Завершено ${count} отправок квестов`);
        saveDB(); emitBankUpdate();
        socket.emit('admin:quest:completedSelected', { count });
    });

    // Admin: Complete all tasks
    socket.on('admin:task:completeAll', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        let count = 0;
        db.taskAssignments.forEach(t => {
            if (t.submissions) {
                t.submissions.filter(s => s.status === 'pending').forEach(s => {
                    s.status = 'failed';
                    s.reviewedAt = Date.now();
                    s.adminComment = 'Завершено администратором';
                    emitToUser(s.userId, 'task:reviewed', { taskId: t.id, verdict: 'failed', reward: 0, xp: 0 });
                    count++;
                });
            }
            t.active = false;
        });
        logAdminAction('task_complete_all', null, null, null, null, `Завершено ${count} отправок заданий`);
        saveDB(); emitBankUpdate();
        socket.emit('admin:task:completedAll', { count });
    });

    // Admin: Complete selected tasks
    socket.on('admin:task:completeSelected', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const ids = Array.isArray(data?.taskIds) ? data.taskIds : [];
        let count = 0;
        ids.forEach(id => {
            const t = db.taskAssignments.find(x => x.id === id);
            if (t) {
                if (t.submissions) {
                    t.submissions.filter(s => s.status === 'pending').forEach(s => {
                        s.status = 'failed';
                        s.reviewedAt = Date.now();
                        s.adminComment = 'Завершено администратором';
                        emitToUser(s.userId, 'task:reviewed', { taskId: t.id, verdict: 'failed', reward: 0, xp: 0 });
                        count++;
                    });
                }
                t.active = false;
            }
        });
        logAdminAction('task_complete_selected', null, null, null, null, `Завершено ${count} отправок заданий`);
        saveDB(); emitBankUpdate();
        socket.emit('admin:task:completedSelected', { count });
    });

    // ==================== ADMIN INVESTMENTS VIEW ====================
    socket.on('admin:getAllInvestments', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const allInvs = db.investments.map(inv => {
            const user = findUser(inv.userId);
            let currentPrice = inv.price;
            if (inv.type && db.investmentPrices[inv.type]) currentPrice = db.investmentPrices[inv.type];
            else if (inv.btcPrice) currentPrice = db.btcPrice;
            const currentValue = inv.units ? Math.round(inv.units * currentPrice) : (inv.btcAmount ? Math.round(inv.btcAmount * currentPrice) : inv.amount);
            const profit = currentValue - inv.amount;
            const pctChange = inv.amount > 0 ? Math.round((profit / inv.amount) * 100) : 0;
            return { ...inv, userName: user?.name || 'Unknown', currentPrice, currentValue, profit, pctChange };
        });
        socket.emit('admin:allInvestments', { investments: allInvs, prices: db.investmentPrices, btcPrice: db.btcPrice });
    });

    // ==================== APPROVAL REQUESTS ====================

    // Get approval requests (filtered by role)
    socket.on('approval:getList', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const adm = isAdmin(socket.id);
        if (adm) {
            // Admin sees all approval requests
            const requests = db.approvalRequests.sort((a, b) => b.createdAt - a.createdAt);
            socket.emit('approval:list', { requests });
        } else {
            // User sees only their own requests
            const requests = db.approvalRequests.filter(r => r.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
            socket.emit('approval:list', { requests });
        }
    });

    // Admin: Approve request
    socket.on('admin:approveRequest', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const req = db.approvalRequests.find(r => r.id === data?.requestId);
        if (!req) { socket.emit('error', { message: 'Заявка не найдена.' }); return; }
        if (req.status !== 'pending') { socket.emit('error', { message: 'Заявка уже обработана.' }); return; }

        const comment = (data?.comment || '').trim();
        req.status = 'approved';
        req.reviewedAt = Date.now();
        req.adminComment = comment;

        // Execute the action based on type
        if (req.type === 'purchase') {
            const purchaseReq = db.purchaseRequests.find(r => r.id === req.data.purchaseRequestId);
            if (purchaseReq && purchaseReq.status === 'pending') {
                const buyer = findUser(purchaseReq.userId);
                if (buyer) {
                    const price = purchaseReq.repricedAmount || purchaseReq.amount;
                    if (buyer.balance >= price) {
                        const oldBalance = buyer.balance;
                        buyer.balance -= price;
                        touchUser(buyer);
                        purchaseReq.status = 'approved';
                        purchaseReq.updatedAt = Date.now();
                        purchaseReq.approvedPrice = price;
                        const tx = { id: genId(), type: 'purchase', userId: buyer.id, userName: buyer.name, amount: price, timestamp: Date.now(), description: 'Покупка: ' + purchaseReq.reason, reason: purchaseReq.reason, oldBalance, newBalance: buyer.balance };
                        db.history.push(tx);
                        emitToUser(buyer.id, 'purchase:approved', { request: purchaseReq, tx });
                        emitToUser(buyer.id, 'transaction:new', tx);
                    } else {
                        purchaseReq.status = 'denied_insufficient';
                        purchaseReq.updatedAt = Date.now();
                    }
                }
            }
        } else if (req.type === 'quest') {
            const quest = db.quests.find(q => q.id === req.data.questId);
            if (quest && quest.submissions) {
                const sub = quest.submissions.find(s => s.id === req.data.submissionId);
                if (sub && sub.status === 'pending') {
                    sub.status = 'completed';
                    sub.reviewedAt = Date.now();
                    sub.adminComment = comment;
                    const target = findUser(sub.userId);
                    if (target) {
                        const reward = sub.customReward ? sub.customReward : quest.reward * 3;
                        const xpAmount = sub.customXP ? sub.customXP : quest.xp * 3;
                        target.balance += reward;
                        touchUser(target);
                        const tx = { id: genId(), type: 'quest_reward', userId: target.id, userName: target.name, amount: reward, timestamp: Date.now(), description: 'Квест: ' + quest.title, oldBalance: target.balance - reward, newBalance: target.balance };
                        db.history.push(tx);
                        addXP(sub.userId, xpAmount, 'Квест: ' + quest.title);
                        emitToUser(sub.userId, 'notification:new', { type: 'received', from: 'Квесты', amount: reward, message: 'Награда за квест: ' + quest.title });
                        emitToUser(sub.userId, 'quest:reviewed', { questId: quest.id, verdict: 'completed', reward, xp: xpAmount });
                    }
                }
            }
        } else if (req.type === 'task') {
            const task = db.taskAssignments.find(t => t.id === req.data.taskId);
            if (task && task.submissions) {
                const sub = task.submissions.find(s => s.id === req.data.submissionId);
                if (sub && sub.status === 'pending') {
                    sub.status = 'completed';
                    sub.reviewedAt = Date.now();
                    sub.adminComment = comment;
                    const target = findUser(sub.userId);
                    if (target) {
                        const reward = sub.customReward ? sub.customReward : task.reward * 3;
                        const xpAmount = sub.customXP ? sub.customXP : task.xp * 3;
                        target.balance += reward;
                        touchUser(target);
                        const tx = { id: genId(), type: 'task_reward', userId: target.id, userName: target.name, amount: reward, timestamp: Date.now(), description: 'Задание: ' + task.title, oldBalance: target.balance - reward, newBalance: target.balance };
                        db.history.push(tx);
                        addXP(sub.userId, xpAmount, 'Задание: ' + task.title);
                        emitToUser(sub.userId, 'notification:new', { type: 'received', from: 'Задания', amount: reward, message: 'Награда за задание: ' + task.title });
                        emitToUser(sub.userId, 'task:reviewed', { taskId: task.id, verdict: 'completed', reward, xp: xpAmount });
                    }
                }
            }
        } else if (req.type === 'duel') {
            const duel = db.duels.find(d => d.id === req.data.duelId);
            if (duel && (duel.status === 'review' || duel.status === 'finished') && !duel.reviewedAt) {
                const winnerIds = req.data.winnerIds || duel.participants.map(p => p.userId);
                duel.status = 'finished';
                duel.reviewedAt = Date.now();
                duel.winnerIds = winnerIds;
                duel.participants.forEach(p => {
                    const user = findUser(p.userId);
                    if (!user) return;
                    const isWinner = winnerIds.includes(p.userId);
                    const reward = isWinner ? duel.reward : Math.round(duel.reward * 0.3);
                    const xpAmount = isWinner ? duel.xp : Math.round(duel.xp * 0.3);
                    user.balance += reward;
                    touchUser(user);
                    const tx = { id: genId(), type: 'duel_reward', userId: user.id, userName: user.name, amount: reward, timestamp: Date.now(), description: 'Дуэль: ' + duel.title + (isWinner ? ' (победа)' : ' (участие)'), oldBalance: user.balance - reward, newBalance: user.balance };
                    db.history.push(tx);
                    addXP(p.userId, xpAmount, 'Дуэль: ' + duel.title);
                    emitToUser(p.userId, 'duel:finished', { duel, isWinner, reward, xp: xpAmount });
                });
            }
        } else if (req.type === 'coupon') {
            // Coupon purchase approval - just mark as approved, coupon was already issued
        }

        // Notify user about approval
        emitToUser(req.userId, 'approval:resolved', { requestId: req.id, status: 'approved', type: req.type, comment });
        // Create a notification for the user
        const userNotif = {
            id: genId(),
            targetUserId: req.userId,
            title: '✅ Заявка одобрена',
            text: getApprovalDescription(req) + (comment ? '\nКомментарий: ' + comment : ''),
            timestamp: Date.now(),
            read: false,
            senderName: 'Система'
        };
        db.notifications.push(userNotif);
        emitToUser(req.userId, 'notification:push', userNotif);

        logAdminAction('approve_request', req.userId, req.userName, null, req.type, getApprovalDescription(req));
        saveDB();
        emitBankUpdate();
        for (const sid of adminSockets) { io.to(sid).emit('approval:reviewed', { request: req }); }
    });

    // Admin: Reject request
    socket.on('admin:rejectRequest', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const req = db.approvalRequests.find(r => r.id === data?.requestId);
        if (!req) { socket.emit('error', { message: 'Заявка не найдена.' }); return; }
        if (req.status !== 'pending') { socket.emit('error', { message: 'Заявка уже обработана.' }); return; }

        const comment = (data?.comment || '').trim();
        req.status = 'rejected';
        req.reviewedAt = Date.now();
        req.adminComment = comment;

        // Handle rejection based on type
        if (req.type === 'purchase') {
            const purchaseReq = db.purchaseRequests.find(r => r.id === req.data.purchaseRequestId);
            if (purchaseReq) {
                purchaseReq.status = 'denied';
                purchaseReq.updatedAt = Date.now();
                emitToUser(purchaseReq.userId, 'purchase:denied', { request: purchaseReq });
            }
        } else if (req.type === 'quest') {
            const quest = db.quests.find(q => q.id === req.data.questId);
            if (quest && quest.submissions) {
                const sub = quest.submissions.find(s => s.id === req.data.submissionId);
                if (sub) {
                    sub.status = 'failed';
                    sub.reviewedAt = Date.now();
                    sub.adminComment = comment;
                    emitToUser(sub.userId, 'quest:reviewed', { questId: quest.id, verdict: 'failed', reward: 0, xp: 0 });
                }
            }
        } else if (req.type === 'task') {
            const task = db.taskAssignments.find(t => t.id === req.data.taskId);
            if (task && task.submissions) {
                const sub = task.submissions.find(s => s.id === req.data.submissionId);
                if (sub) {
                    sub.status = 'failed';
                    sub.reviewedAt = Date.now();
                    sub.adminComment = comment;
                    emitToUser(sub.userId, 'task:reviewed', { taskId: task.id, verdict: 'failed', reward: 0, xp: 0 });
                }
            }
        } else if (req.type === 'duel') {
            const duel = db.duels.find(d => d.id === req.data.duelId);
            if (duel) {
                duel.status = 'finished';
                duel.reviewedAt = Date.now();
                duel.winnerIds = [];
                duel.participants.forEach(p => {
                    emitToUser(p.userId, 'duel:finished', { duel, isWinner: false, reward: 0, xp: 0 });
                });
            }
        }

        // Notify user about rejection
        emitToUser(req.userId, 'approval:resolved', { requestId: req.id, status: 'rejected', type: req.type, comment });
        const userNotif = {
            id: genId(),
            targetUserId: req.userId,
            title: '❌ Заявка отклонена',
            text: getApprovalDescription(req) + (comment ? '\nПричина: ' + comment : ''),
            timestamp: Date.now(),
            read: false,
            senderName: 'Система'
        };
        db.notifications.push(userNotif);
        emitToUser(req.userId, 'notification:push', userNotif);

        logAdminAction('reject_request', req.userId, req.userName, null, req.type, getApprovalDescription(req));
        saveDB();
        emitBankUpdate();
        for (const sid of adminSockets) { io.to(sid).emit('approval:reviewed', { request: req }); }
    });

    function getApprovalDescription(req) {
        if (req.type === 'purchase') return 'Покупка: ' + (req.data.reason || '');
        if (req.type === 'quest') return 'Квест: ' + (req.data.questTitle || '');
        if (req.type === 'task') return 'Задание: ' + (req.data.taskTitle || '');
        if (req.type === 'duel') return 'Дуэль: ' + (req.data.duelTitle || '');
        if (req.type === 'coupon') return 'Купон: ' + (req.data.couponName || '');
        return 'Заявка';
    }

    // ==================== USER PROFILE CUSTOMIZATION ====================

    // --- User: Set Nickname ---
    socket.on('user:setNickname', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const nickname = (data?.nickname || '').trim();
        if (nickname.length > 30) { socket.emit('error', { message: 'Никнейм: максимум 30 символов.' }); return; }
        user.nickname = nickname ? nickname : null;
        saveDB();
        const onlineIds = getOnlineUserIds();
        socket.emit('user:profileUpdated', { user: publicUserFull(user, onlineIds) });
        emitBankUpdate();
        socket.emit('user:notify', { type: 's', title: 'Профиль', body: 'Никнейм обновлён' });
    });

    // --- User: Set Title ---
    socket.on('user:setTitle', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const title = (data?.title || '').trim();
        if (title.length > 30) { socket.emit('error', { message: 'Титул: максимум 30 символов.' }); return; }
        user.title = title ? title : null;
        saveDB();
        const onlineIds = getOnlineUserIds();
        socket.emit('user:profileUpdated', { user: publicUserFull(user, onlineIds) });
        emitBankUpdate();
        socket.emit('user:notify', { type: 's', title: 'Профиль', body: 'Титул обновлён' });
    });

    // --- User: Set Profile Color ---
    socket.on('user:setProfileColor', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const color = data?.color;
        if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) { socket.emit('error', { message: 'Недопустимый цвет.' }); return; }
        user.profileColor = (color && color !== '') ? color : null;
        saveDB();
        const onlineIds = getOnlineUserIds();
        socket.emit('user:profileUpdated', { user: publicUserFull(user, onlineIds) });
        emitBankUpdate();
        socket.emit('user:notify', { type: 's', title: 'Профиль', body: 'Цвет профиля изменён' });
    });

    // --- User: Set Profile Icon ---
    socket.on('user:setProfileIcon', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const icon = data?.icon;
        const validIcons = ['👤','⭐','👑','🐉','🐼','💎','🐯','🎓','💰','🦁','🔥','🌟','🎯','🚀','🦊','🐺','🎮','🎵','📚','⚡','🌊','🍀','🌙','☀️','💫','🎪','🏆','🎖️','🦅','🦋'];
        if (icon && !validIcons.includes(icon)) { socket.emit('error', { message: 'Недопустимая иконка.' }); return; }
        user.profileIcon = (icon && icon !== '') ? icon : null;
        saveDB();
        const onlineIds = getOnlineUserIds();
        socket.emit('user:profileUpdated', { user: publicUserFull(user, onlineIds) });
        emitBankUpdate();
        socket.emit('user:notify', { type: 's', title: 'Профиль', body: 'Иконка профиля изменена' });
    });

    // --- User: Set Profile Photo ---
    socket.on('user:setProfilePhoto', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const photo = data?.photo;
        if (photo === null || photo === '') {
            user.profilePhoto = null;
        } else {
            const cleanPhoto = sanitizeImageSrc(photo);
            if (!cleanPhoto || cleanPhoto.length >= 700000) {
                socket.emit('error', { message: 'Фото: JPG/PNG/WEBP, макс 2 МБ.' }); return;
            }
            user.profilePhoto = cleanPhoto;
        }
        saveDB();
        const onlineIds = getOnlineUserIds();
        socket.emit('user:profileUpdated', { user: publicUserFull(user, onlineIds) });
        emitBankUpdate();
        socket.emit('user:notify', { type: 's', title: 'Профиль', body: user.profilePhoto ? 'Фото профиля обновлено' : 'Фото профиля удалено' });
    });

    // --- User: Set Neon Color ---
    socket.on('user:setNeonColor', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const color = data?.color;
        if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) { socket.emit('error', { message: 'Недопустимый цвет.' }); return; }
        user.neonColor = (color && color !== '') ? color : null;
        saveDB();
        const onlineIds = getOnlineUserIds();
        socket.emit('user:profileUpdated', { user: publicUserFull(user, onlineIds) });
        emitBankUpdate();
        socket.emit('user:notify', { type: 's', title: 'Профиль', body: 'Неоновая рамка изменена' });
    });

    // --- User: Set Nickname/Title Color ---
    socket.on('user:setNickColor', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const color = data?.color;
        if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) { socket.emit('error', { message: 'Недопустимый цвет.' }); return; }
        user.nickColor = (color && color !== '') ? color : null;
        saveDB();
        const onlineIds = getOnlineUserIds();
        socket.emit('user:profileUpdated', { user: publicUserFull(user, onlineIds) });
        emitBankUpdate();
        socket.emit('user:notify', { type: 's', title: 'Профиль', body: 'Цвет никнейма изменён' });
    });

    // --- User: Change PIN ---
    socket.on('user:changePin', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        if (!user.pinHash) { socket.emit('user:changePinResult', { success: false, message: 'PIN не установлен. Установите PIN при входе.' }); return; }
        const currentPin = String(data?.currentPin || '');
        const newPin = String(data?.newPin || '');
        const confirmPin = String(data?.confirmPin || '');
        if (!/^\d{4}$/.test(currentPin)) { socket.emit('user:changePinResult', { success: false, message: 'Введите текущий PIN (4 цифры).' }); return; }
        if (!/^\d{4}$/.test(newPin)) { socket.emit('user:changePinResult', { success: false, message: 'Новый PIN: ровно 4 цифры.' }); return; }
        if (newPin !== confirmPin) { socket.emit('user:changePinResult', { success: false, message: 'PIN-коды не совпадают.' }); return; }
        try {
            if (!verifyPin(currentPin, user.pinHash, user.salt)) {
                socket.emit('user:changePinResult', { success: false, message: 'Неверный текущий PIN-код.' });
                return;
            }
        } catch {
            socket.emit('user:changePinResult', { success: false, message: 'Ошибка проверки PIN.' });
            return;
        }
        const { hash, salt } = hashPin(newPin);
        user.pinHash = hash;
        user.salt = salt;
        saveDB();
        socket.emit('user:changePinResult', { success: true, message: 'PIN-код успешно изменён' });
        socket.emit('user:notify', { type: 's', title: 'PIN', body: 'PIN-код успешно изменён' });
    });

    // --- Activity heartbeat ---
    socket.on('user:activity', () => {
        const userId = socketUserMap.get(socket.id);
        if (userId) markUserSeen(userId);
    });

    // ==================== CLEAR ALL GAME DATA ====================
    socket.on('admin:clearAllGameData', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const parts = [];
        if (data?.clearDuels) {
            db.duels = [];
            parts.push('дуэли');
        }
        if (data?.clearQuests) {
            db.quests = [];
            parts.push('квесты');
        }
        if (data?.clearTasks) {
            db.taskAssignments = [];
            parts.push('задания');
        }
        if (data?.clearApprovalRequests) {
            db.approvalRequests = [];
            parts.push('заявки');
        }
        if (data?.clearMessages) {
            db.messages = [];
            parts.push('сообщения');
        }
        if (data?.clearNotifications) {
            db.notifications = [];
            parts.push('уведомления');
        }
        logAdminAction('clear_all_game_data', null, null, null, null, `Очищено: ${parts.join(', ')}`);
        saveDB();
        emitBankUpdate();
        socket.emit('admin:clearAllGameData:result', { message: `Очищено: ${parts.join(', ')}`, parts });
    });

    // ==================== POINTS AWARD ====================
    socket.on('admin:awardPoints', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetUser = findUser(data?.targetId);
        if (!targetUser) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const amount = Number(data?.amount) || 0;
        if (amount <= 0) { socket.emit('error', { message: 'Укажите количество баллов.' }); return; }
        const reason = (data?.reason || '').trim();
        const adminName = findUser(socketUserMap.get(socket.id))?.name || 'Администратор';
        // Create notification for the user
        const notif = {
            id: genId(), targetUserId: data.targetId,
            title: '🎉 Начисление баллов',
            text: `Вам начислено +${amount} баллов${reason ? '. Причина: ' + reason : ''}`,
            timestamp: Date.now(), read: false, senderName: adminName,
            type: 'points_awarded', amount, reason
        };
        db.notifications.push(notif);
        logAdminAction('award_points', data.targetId, targetUser.name, amount, reason, null);
        saveDB();
        // Notify user if online
        emitToUser(data.targetId, 'notification:push', notif);
        socket.emit('admin:awardPoints:result', { success: true });
    });

    // ==================== USER LISTS ====================
    socket.on('list:add', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        if (!db.userLists[userId]) db.userLists[userId] = { quests: [], tasks: [] };
        const list = data?.type === 'quest' ? db.userLists[userId].quests : db.userLists[userId].tasks;
        if (data?.itemId && !list.includes(data.itemId)) {
            list.push(data.itemId);
            saveDB();
        }
        socket.emit('list:update', db.userLists[userId]);
    });

    socket.on('list:remove', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        if (!db.userLists[userId]) db.userLists[userId] = { quests: [], tasks: [] };
        if (data?.type === 'quest') {
            db.userLists[userId].quests = db.userLists[userId].quests.filter(id => id !== data.itemId);
        } else {
            db.userLists[userId].tasks = db.userLists[userId].tasks.filter(id => id !== data.itemId);
        }
        saveDB();
        socket.emit('list:update', db.userLists[userId]);
    });

    socket.on('list:get', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        socket.emit('list:update', db.userLists[userId] || { quests: [], tasks: [] });
    });

    // ==================== REST SYSTEM ====================
    socket.on('admin:startRest', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetUser = findUser(data?.targetId);
        if (!targetUser) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const durationMinutes = Number(data?.durationMinutes) || 5;
        const now = Date.now();
        const rest = {
            id: genId(),
            userId: data.targetId,
            userName: targetUser.name,
            durationMinutes,
            startsAt: now,
            endsAt: now + durationMinutes * 60 * 1000,
            status: 'active',
            createdBy: socketUserMap.get(socket.id)
        };
        db.rests.push(rest);
        logAdminAction('start_rest', data.targetId, targetUser.name, null, null, `Отдых ${durationMinutes} мин`);
        saveDB();
        // Notify user
        const restData = { id: rest.id, durationMinutes, endsAt: rest.endsAt };
        emitToUser(data.targetId, 'rest:start', restData);
        socket.emit('admin:rest:started', { rest });
    });

    socket.on('rest:getActive', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const activeRests = db.rests.filter(r => r.userId === userId && r.status === 'active' && r.endsAt > Date.now());
        socket.emit('rest:activeList', { rests: activeRests });
    });

    // ==================== USER BLOCKING SYSTEM ====================

    socket.on('admin:blockUser', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetId = data?.targetId;
        const target = findUser(targetId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const mode = data?.mode || 'standard'; // 'standard' or 'hidden'
        const duration = data?.duration || 'forever';
        const reason = (data?.reason || '').trim();
        if (mode === 'standard' && !reason) { socket.emit('error', { message: 'Укажите причину блокировки.' }); return; }
        // Remove existing block for this user
        db.userBlocks = db.userBlocks.filter(b => b.userId !== targetId);
        const durationMs = { '1h': 3600000, '6h': 21600000, '1d': 86400000, '3d': 259200000, '7d': 604800000, '30d': 2592000000 };
        const block = {
            id: genId(), userId: targetId, userName: target.name,
            mode, duration, reason,
            createdAt: Date.now(),
            expiresAt: duration === 'forever' ? null : Date.now() + (durationMs[duration] || 0)
        };
        db.userBlocks.push(block);
        logAdminAction('block_user', targetId, target.name, null, reason, `${mode} блокировка, срок: ${duration}`);
        saveDB();
        // Force disconnect blocked user
        const targetSockets = getUserSockets(targetId);
        for (const sid of targetSockets) {
            io.to(sid).emit('user:kicked', { blocked: true, mode, reason: mode === 'standard' ? reason : null, expiresAt: block.expiresAt });
            removeSocket(sid);
        }
        socket.emit('admin:blockResult', { block });
        emitBankUpdate();
    });

    socket.on('admin:unblockUser', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetId = data?.targetId;
        const block = db.userBlocks.find(b => b.userId === targetId);
        if (!block) { socket.emit('error', { message: 'Пользователь не заблокирован.' }); return; }
        db.userBlocks = db.userBlocks.filter(b => b.userId !== targetId);
        logAdminAction('unblock_user', targetId, block.userName, null, null, null);
        saveDB();
        emitToUser(targetId, 'user:unblocked', {});
        socket.emit('admin:unblockResult', { userId: targetId, userName: block.userName });
        emitBankUpdate();
    });

    socket.on('admin:getBlocks', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        // Clean expired blocks
        const now = Date.now();
        db.userBlocks = db.userBlocks.filter(b => b.expiresAt === null || b.expiresAt > now);
        saveDB();
        socket.emit('admin:blockList', { blocks: db.userBlocks });
    });

    socket.on('user:checkBlock', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const now = Date.now();
        const block = db.userBlocks.find(b => b.userId === userId && (b.expiresAt === null || b.expiresAt > now));
        if (block) {
            socket.emit('user:blockStatus', { blocked: true, mode: block.mode, reason: block.mode === 'standard' ? block.reason : null, expiresAt: block.expiresAt });
        } else {
            socket.emit('user:blockStatus', { blocked: false });
        }
    });

    // ==================== QR TERMINAL SYSTEM ====================

    socket.on('qr:getUsers', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const onlineIds = getOnlineUserIds();
        const usersList = db.users.map(u => ({
            id: u.id, name: u.name, balance: u.balance,
            online: onlineIds.has(u.id)
        }));
        socket.emit('qr:usersList', { users: usersList });
    });

    socket.on('qr:generateData', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const user = findUser(userId);
        if (!user) return;
        // Generate QR data containing user ID and name
        const qrData = JSON.stringify({ type: 'mandarin_pay', userId: user.id, ts: Date.now() });
        socket.emit('qr:data', { qrData, userId: user.id, name: user.name, balance: user.balance });
    });

    socket.on('qr:processPayment', (data) => {
        const scannerId = socketUserMap.get(socket.id);
        if (!scannerId) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const scanner = findUser(scannerId);
        if (!scanner) { socket.emit('error', { message: 'Не авторизован.' }); return; }

        const targetUserId = data?.targetUserId;
        const amount = Number(data?.amount);

        if (!targetUserId) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        if (targetUserId === scannerId) { socket.emit('error', { message: 'Нельзя сканировать собственный QR-код.' }); return; }
        const target = findUser(targetUserId);
        if (!target) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        if (target.balance < amount) { socket.emit('error', { message: 'Недостаточно средств у ' + target.name + '. Баланс: ' + target.balance + ' 分' }); return; }

        // Atomic transfer: QR-owner → scanner
        const targetOldBalance = target.balance;
        const scannerOldBalance = scanner.balance;
        target.balance -= amount;
        scanner.balance += amount;
        touchUser(target);
        touchUser(scanner);

        const txOwner = {
            id: genId(), type: 'qr_transfer',
            userId: target.id, userName: target.name,
            amount, timestamp: Date.now(),
            description: '🔄 QR-перевод · Передано пользователю: ' + scanner.name,
            oldBalance: targetOldBalance, newBalance: target.balance,
            counterpartId: scanner.id, counterpartName: scanner.name,
            direction: 'sent'
        };

        const txScanner = {
            id: genId(), type: 'qr_transfer',
            userId: scanner.id, userName: scanner.name,
            amount, timestamp: Date.now(),
            description: '🔄 QR-перевод · Получено от: ' + target.name,
            oldBalance: scannerOldBalance, newBalance: scanner.balance,
            counterpartId: target.id, counterpartName: target.name,
            direction: 'received'
        };

        db.history.push(txOwner);
        db.history.push(txScanner);
        db.qrTerminalHistory.push(txOwner);
        db.qrTerminalHistory.push(txScanner);

        saveDB();

        socket.emit('qr:paymentSuccess', { tx: txScanner, userName: target.name, newBalance: scanner.balance, receivedAmount: amount });
        emitToUser(target.id, 'transaction:new', txOwner);
        emitToUser(target.id, 'notification:new', { type: 'qr_transfer', amount, from: scanner.name, message: '🔄 QR-перевод: −' + amount + ' 分 → ' + scanner.name });
        emitBankUpdate();
    });

    socket.on('qr:getHistory', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const history = db.qrTerminalHistory.filter(h => h.userId === userId).slice(-50).reverse();
        socket.emit('qr:history', { history });
    });

    // ==================== ADMIN QR CODE SYSTEM ====================

    // Anti-double-spend lock
    if (!global._qrScanLocks) global._qrScanLocks = new Set();

    socket.on('admin:qrCodes:create', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId || !isAdmin(socket.id)) { socket.emit('error', { message: 'Нет прав.' }); return; }
        const name = (data?.name || '').trim();
        const description = (data?.description || '').trim();
        const action = data?.action || null;
        const usageType = data?.usageType || 'limited';
        const maxTotalScans = Number(data?.maxTotalScans) || 100;
        const maxScansPerUser = Number(data?.maxScansPerUser) || (usageType === 'once' ? 1 : 999);
        const expiresAt = data?.expiresAt ? Number(data.expiresAt) : null;

        if (!name) { socket.emit('error', { message: 'Введите название QR-кода.' }); return; }
        if (!action || !action.operation) { socket.emit('error', { message: 'Выберите действие.' }); return; }

        const token = crypto.randomBytes(16).toString('hex');
        const qrId = genId();
        const qrCode = {
            id: qrId, name, description,
            action: action,
            usageType: usageType,
            maxTotalScans: usageType === 'unlimited' ? 999999 : maxTotalScans,
            maxScansPerUser: maxScansPerUser,
            expiresAt, token, totalScans: 0,
            status: 'active',
            createdAt: Date.now(), createdBy: userId,
            // Backward compat
            operationType: action.operation === 'addMoney' ? 'reward' : action.operation === 'withdraw' ? 'charge' : 'other',
            amount: action.params?.amount || 0,
            accountId: null, testConfig: null
        };

        db.qrCodes.push(qrCode);
        saveDB();
        socket.emit('admin:qrCodes:created', { qrCode });
    });

    socket.on('admin:qrCodes:getAll', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId || !isAdmin(socket.id)) return;
        const qrList = db.qrCodes.map(qr => {
            const account = db.qrAccounts.find(a => a.id === qr.accountId);
            const scans = db.qrCodeScans.filter(s => s.qrCodeId === qr.id);
            const uniqueUserIds = new Set(scans.map(s => s.userId));
            return {
                ...qr,
                accountBalance: account ? account.balance : 0,
                totalScans: scans.length,
                uniqueUsers: uniqueUserIds.size,
                lastScanAt: scans.length ? Math.max(...scans.map(s => s.timestamp)) : null,
                isExpired: qr.expiresAt && Date.now() > qr.expiresAt
            };
        });
        socket.emit('admin:qrCodes:list', { qrCodes: qrList });
    });

    socket.on('admin:qrCodes:toggle', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId || !isAdmin(socket.id)) return;
        const qr = db.qrCodes.find(q => q.id === data?.qrId);
        if (!qr) { socket.emit('error', { message: 'QR-код не найден.' }); return; }
        qr.status = qr.status === 'active' ? 'disabled' : 'active';
        saveDB();
        socket.emit('admin:qrCodes:toggled', { qrId: qr.id, status: qr.status });
    });

    socket.on('admin:qrCodes:delete', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId || !isAdmin(socket.id)) return;
        db.qrCodes = db.qrCodes.filter(q => q.id !== data?.qrId);
        db.qrAccounts = db.qrAccounts.filter(a => a.qrCodeId !== data?.qrId);
        db.qrCodeScans = db.qrCodeScans.filter(s => s.qrCodeId !== data?.qrId);
        db.testResults = db.testResults.filter(t => t.qrCodeId !== data?.qrId);
        saveDB();
        socket.emit('admin:qrCodes:deleted', { qrId: data?.qrId });
    });

    socket.on('admin:qrCodes:getAccount', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId || !isAdmin(socket.id)) return;
        const account = db.qrAccounts.find(a => a.qrCodeId === data?.qrId);
        const scans = db.qrCodeScans.filter(s => s.qrCodeId === data?.qrId).sort((a, b) => b.timestamp - a.timestamp);
        socket.emit('admin:qrCodes:accountData', { account, scans });
    });

    socket.on('admin:qrCodes:getStats', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId || !isAdmin(socket.id)) return;
        const qr = db.qrCodes.find(q => q.id === data?.qrId);
        if (!qr) return;
        const scans = db.qrCodeScans.filter(s => s.qrCodeId === qr.id);
        const userScanCounts = {};
        scans.forEach(s => { userScanCounts[s.userId] = (userScanCounts[s.userId] || 0) + 1; });
        const account = db.qrAccounts.find(a => a.id === qr.accountId);
        socket.emit('admin:qrCodes:stats', {
            qrId: qr.id,
            totalScans: scans.length,
            uniqueUsers: Object.keys(userScanCounts).length,
            totalPoints: account ? account.balance : 0,
            userScanCounts,
            lastScanAt: scans.length ? Math.max(...scans.map(s => s.timestamp)) : null,
            status: qr.status
        });
    });

    // ==================== QR CODE ACTION ENGINE (user scans admin QR) ====================

    socket.on('qr:executeAction', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) { socket.emit('qr:actionResult', { success: false, message: 'Не авторизован.' }); return; }
        const user = findUser(userId);
        if (!user) { socket.emit('qr:actionResult', { success: false, message: 'Пользователь не найден.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('qr:actionResult', { success: false, message: 'Ваш аккаунт заблокирован.' }); return; }

        const qrId = data?.qrId;
        const token = data?.token;
        const qr = db.qrCodes.find(q => q.id === qrId && q.token === token);
        if (!qr) { socket.emit('qr:actionResult', { success: false, message: 'QR-код не найден.' }); return; }
        if (qr.status !== 'active') { socket.emit('qr:actionResult', { success: false, message: 'QR-код деактивирован.' }); return; }
        if (qr.expiresAt && Date.now() > qr.expiresAt) {
            qr.status = 'expired'; saveDB();
            socket.emit('qr:actionResult', { success: false, message: 'Срок действия QR-кода истёк.' }); return;
        }

        const lockKey = qrId + ':' + userId;
        if (global._qrScanLocks.has(lockKey)) {
            socket.emit('qr:actionResult', { success: false, message: 'Операция обрабатывается...' }); return;
        }

        const userScans = db.qrCodeScans.filter(s => s.qrCodeId === qrId && s.userId === userId);
        if (qr.usageType === 'once' && userScans.length >= 1) {
            socket.emit('qr:actionResult', { success: false, message: 'Вы уже использовали этот QR-код.' }); return;
        }
        if (qr.maxScansPerUser && userScans.length >= qr.maxScansPerUser) {
            socket.emit('qr:actionResult', { success: false, message: 'Лимит использований достигнут.' }); return;
        }
        if (qr.usageType === 'limited' && qr.totalScans >= qr.maxTotalScans) {
            socket.emit('qr:actionResult', { success: false, message: 'QR-код исчерпан.' }); return;
        }

        global._qrScanLocks.add(lockKey);

        try {
            const action = qr.action || { operation: 'addMoney', params: { amount: qr.amount || 100 } };
            const result = executeQrAction(action.operation, userId, action.params, 'qr_code');

            const scan = {
                id: genId(), qrCodeId: qrId, userId, userName: user.name,
                amount: result.amount || 0, timestamp: Date.now(),
                operation: action.operation, status: 'success'
            };
            db.qrCodeScans.push(scan);
            qr.totalScans = (qr.totalScans || 0) + 1;
            saveDB(); emitBankUpdate();

            socket.emit('qr:actionResult', {
                success: true, qrName: qr.name, operation: action.operation,
                message: result.message || 'Операция выполнена',
                amount: result.amount, newBalance: user.balance,
                ...result
            });
        } catch (e) {
            const scan = {
                id: genId(), qrCodeId: qrId, userId, userName: user.name,
                amount: 0, timestamp: Date.now(),
                operation: qr.action?.operation || 'unknown', status: 'error', error: e.message
            };
            db.qrCodeScans.push(scan);
            saveDB();
            socket.emit('qr:actionResult', { success: false, message: e.message });
        } finally {
            global._qrScanLocks.delete(lockKey);
        }
    });

    // ==================== ADMIN QR CODE UPDATE ====================

    socket.on('admin:qrCodes:update', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Нет прав.' }); return; }
        const qr = db.qrCodes.find(q => q.id === data?.qrId);
        if (!qr) { socket.emit('error', { message: 'QR-код не найден.' }); return; }
        if (data.name !== undefined) qr.name = data.name;
        if (data.description !== undefined) qr.description = data.description;
        if (data.maxScansPerUser !== undefined) qr.maxScansPerUser = Number(data.maxScansPerUser);
        if (data.maxTotalScans !== undefined) qr.maxTotalScans = Number(data.maxTotalScans);
        if (data.expiresAt !== undefined) qr.expiresAt = data.expiresAt;
        if (data.usageType !== undefined) qr.usageType = data.usageType;
        saveDB();
        socket.emit('admin:qrCodes:updated', { qrId: qr.id });
    });

    // ==================== QR CODE SCANNING BY USER (legacy) ====================

    socket.on('qr:scanAdminCode', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Пользователь не найден.' }); return; }
        const block = isUserBlocked(userId);
        if (block) { socket.emit('qr:scanResult', { success: false, error: 'blocked', message: 'Ваш аккаунт заблокирован.' }); return; }

        const qrId = data?.qrId;
        if (!qrId) { socket.emit('qr:scanResult', { success: false, error: 'invalid', message: 'Неверный QR-код.' }); return; }

        const qr = db.qrCodes.find(q => q.id === qrId);
        if (!qr) { socket.emit('qr:scanResult', { success: false, error: 'not_found', message: 'QR-код не найден.' }); return; }
        if (qr.status !== 'active') { socket.emit('qr:scanResult', { success: false, error: 'disabled', message: 'QR-код деактивирован.' }); return; }
        if (qr.expiresAt && Date.now() > qr.expiresAt) {
            qr.status = 'expired';
            saveDB();
            socket.emit('qr:scanResult', { success: false, error: 'expired', message: 'Срок действия QR-кода истёк.' }); return;
        }

        // Anti-double-spend lock
        const lockKey = qrId + ':' + userId;
        if (global._qrScanLocks.has(lockKey)) {
            socket.emit('qr:scanResult', { success: false, error: 'processing', message: 'Операция обрабатывается...' }); return;
        }

        // Check scan limit
        const userScans = db.qrCodeScans.filter(s => s.qrCodeId === qrId && s.userId === userId);
        if (userScans.length >= qr.maxScansPerUser) {
            socket.emit('qr:scanResult', { success: false, error: 'limit', message: 'Лимит использований достигнут.' }); return;
        }

        // Lock
        global._qrScanLocks.add(lockKey);

        try {
            if (qr.operationType === 'test') {
                // Test QR: create test result entry
                const testResult = {
                    id: genId(), qrCodeId: qr.id, userId: user.id, userName: user.name,
                    testName: qr.testConfig ? qr.testConfig.testName : qr.name,
                    totalQuestions: qr.testConfig ? qr.testConfig.totalQuestions : 50,
                    date: Date.now(), correctAnswers: 0, errors: 0, percentage: 0,
                    score: 'pending', points: 0, status: 'pending',
                    teacherComment: '', gradedAt: null, gradedBy: null
                };
                db.testResults.push(testResult);

                // Log scan
                const scan = { id: genId(), qrCodeId: qr.id, userId: user.id, userName: user.name, amount: 0, timestamp: Date.now(), operationType: 'test', status: 'success' };
                db.qrCodeScans.push(scan);

                // Update QR account
                const account = db.qrAccounts.find(a => a.id === qr.accountId);
                if (account) { account.totalScans++; account.lastScanAt = Date.now(); const uids = new Set(db.qrCodeScans.filter(s => s.qrCodeId === qr.id).map(s => s.userId)); account.uniqueUsers = uids.size; }

                saveDB();
                socket.emit('qr:scanResult', { success: true, type: 'test', testName: testResult.testName, testResultId: testResult.id, message: 'Тест «' + testResult.testName + '» добавлен. Ожидайте проверки.' });

            } else if (qr.operationType === 'reward') {
                // Reward: add points to user
                if (user.balance + qr.amount > 100000000) {
                    socket.emit('qr:scanResult', { success: false, error: 'limit_balance', message: 'Превышен максимальный баланс.' });
                    global._qrScanLocks.delete(lockKey);
                    return;
                }

                const oldBal = user.balance;
                user.balance += qr.amount;
                touchUser(user);

                // Log transaction
                const tx = { id: genId(), type: 'qr_reward', userId: user.id, userName: user.name, amount: qr.amount, timestamp: Date.now(), description: '🎁 QR-награда: ' + qr.name, oldBalance: oldBal, newBalance: user.balance, qrCodeId: qr.id };
                db.history.push(tx);

                // Log scan
                const scan = { id: genId(), qrCodeId: qr.id, userId: user.id, userName: user.name, amount: qr.amount, timestamp: Date.now(), operationType: 'reward', status: 'success' };
                db.qrCodeScans.push(scan);

                // Update QR account
                const account = db.qrAccounts.find(a => a.id === qr.accountId);
                if (account) { account.balance += qr.amount; account.totalScans++; account.lastScanAt = Date.now(); const uids = new Set(db.qrCodeScans.filter(s => s.qrCodeId === qr.id).map(s => s.userId)); account.uniqueUsers = uids.size; }

                saveDB();
                socket.emit('transaction:new', tx);
                socket.emit('qr:scanResult', { success: true, type: 'reward', amount: qr.amount, newBalance: user.balance, message: '+' + qr.amount + ' MP начислено!', qrName: qr.name });
                emitBankUpdate();

            } else if (qr.operationType === 'charge') {
                // Charge: deduct points from user
                if (user.balance < qr.amount) {
                    const scan = { id: genId(), qrCodeId: qr.id, userId: user.id, userName: user.name, amount: 0, timestamp: Date.now(), operationType: 'charge', status: 'insufficient' };
                    db.qrCodeScans.push(scan);
                    saveDB();
                    socket.emit('qr:scanResult', { success: false, error: 'insufficient', message: 'Недостаточно средств. Баланс: ' + user.balance + ' MP, требуется: ' + qr.amount + ' MP.' });
                    global._qrScanLocks.delete(lockKey);
                    return;
                }

                const oldBal = user.balance;
                user.balance -= qr.amount;
                touchUser(user);

                // Log transaction
                const tx = { id: genId(), type: 'qr_charge', userId: user.id, userName: user.name, amount: qr.amount, timestamp: Date.now(), description: '💳 QR-списание: ' + qr.name, oldBalance: oldBal, newBalance: user.balance, qrCodeId: qr.id };
                db.history.push(tx);

                // Log scan
                const scan = { id: genId(), qrCodeId: qr.id, userId: user.id, userName: user.name, amount: qr.amount, timestamp: Date.now(), operationType: 'charge', status: 'success' };
                db.qrCodeScans.push(scan);

                // Update QR account
                const account = db.qrAccounts.find(a => a.id === qr.accountId);
                if (account) { account.balance += qr.amount; account.totalScans++; account.lastScanAt = Date.now(); const uids = new Set(db.qrCodeScans.filter(s => s.qrCodeId === qr.id).map(s => s.userId)); account.uniqueUsers = uids.size; }

                saveDB();
                socket.emit('transaction:new', tx);
                socket.emit('qr:scanResult', { success: true, type: 'charge', amount: qr.amount, newBalance: user.balance, message: '-' + qr.amount + ' MP списано.', qrName: qr.name });
                emitBankUpdate();
            }
        } catch (err) {
            console.error('QR scan error:', err);
            socket.emit('qr:scanResult', { success: false, error: 'server', message: 'Ошибка сервера.' });
        } finally {
            global._qrScanLocks.delete(lockKey);
        }
    });

    // User gets their QR code scan history
    socket.on('qr:getAdminScanHistory', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const scans = db.qrCodeScans.filter(s => s.userId === userId).sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
        socket.emit('qr:adminScanHistory', { scans });
    });

    // ==================== TEST SYSTEM ====================

    socket.on('test:getMyResults', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const results = db.testResults.filter(t => t.userId === userId).sort((a, b) => b.date - a.date);
        socket.emit('test:myResults', { results });
    });

    socket.on('admin:test:getAll', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId || !isAdmin(socket.id)) return;
        const results = db.testResults.sort((a, b) => b.date - a.date);
        socket.emit('admin:test:list', { results });
    });

    socket.on('admin:test:review', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId || !isAdmin(socket.id)) return;
        const result = db.testResults.find(t => t.id === data?.testId);
        if (!result) { socket.emit('error', { message: 'Результат не найден.' }); return; }

        const correctAnswers = Number(data?.correctAnswers);
        const totalQuestions = result.totalQuestions || Number(data?.totalQuestions) || 50;
        const teacherComment = (data?.teacherComment || '').trim();

        if (!Number.isInteger(correctAnswers) || correctAnswers < 0 || correctAnswers > totalQuestions) {
            socket.emit('error', { message: 'Некорректное количество правильных ответов.' }); return;
        }

        const errors = totalQuestions - correctAnswers;
        const percentage = Math.round((correctAnswers / totalQuestions) * 100);

        let score = 'poor';
        if (percentage >= 90) score = 'excellent';
        else if (percentage >= 70) score = 'good';
        else if (percentage >= 50) score = 'satisfactory';

        // Calculate points reward
        let points = 0;
        if (percentage >= 90) points = 500;
        else if (percentage >= 80) points = 300;
        else if (percentage >= 70) points = 200;
        else if (percentage >= 60) points = 100;
        else if (percentage >= 50) points = 50;

        result.correctAnswers = correctAnswers;
        result.errors = errors;
        result.percentage = percentage;
        result.score = score;
        result.points = points;
        result.status = 'graded';
        result.teacherComment = teacherComment;
        result.gradedAt = Date.now();
        result.gradedBy = userId;

        // Award points to user
        const user = findUser(result.userId);
        if (user && points > 0) {
            const oldBal = user.balance;
            user.balance += points;
            touchUser(user);
            const tx = { id: genId(), type: 'test_reward', userId: user.id, userName: user.name, amount: points, timestamp: Date.now(), description: '📝 Награда за тест: ' + result.testName + ' (' + percentage + '%)', oldBalance: oldBal, newBalance: user.balance };
            db.history.push(tx);
            emitToUser(user.id, 'transaction:new', tx);
        }

        saveDB();
        socket.emit('admin:test:reviewed', { testId: result.id, result });
        emitToUser(result.userId, 'test:graded', { result });
        if (user && points > 0) emitBankUpdate();
    });

    // ==================== SAVINGS GOALS (Cyprus Bank) ====================

    socket.on('bank:createGoal', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const name = (data?.name || '').trim();
        const targetAmount = Number(data?.targetAmount);
        if (!name) { socket.emit('error', { message: 'Введите название цели.' }); return; }
        if (!Number.isInteger(targetAmount) || targetAmount <= 0) { socket.emit('error', { message: 'Некорректная целевая сумма.' }); return; }

        const goal = { id: genId(), userId: user.id, name, targetAmount, currentAmount: 0, createdAt: Date.now(), status: 'active' };
        db.savingsGoals.push(goal);
        saveDB();
        socket.emit('bank:goalCreated', { goal });
    });

    socket.on('bank:getGoals', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const goals = db.savingsGoals.filter(g => g.userId === userId);
        socket.emit('bank:goals', { goals });
    });

    socket.on('bank:contributeGoal', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const goal = db.savingsGoals.find(g => g.id === data?.goalId && g.userId === userId && g.status === 'active');
        if (!goal) { socket.emit('error', { message: 'Цель не найдена.' }); return; }
        const amount = Number(data?.amount);
        if (!Number.isInteger(amount) || amount <= 0) { socket.emit('error', { message: 'Некорректная сумма.' }); return; }
        if (user.balance < amount) { socket.emit('error', { message: 'Недостаточно средств.' }); return; }

        const oldBal = user.balance;
        user.balance -= amount;
        goal.currentAmount += amount;
        touchUser(user);

        const tx = { id: genId(), type: 'savings_contribute', userId: user.id, userName: user.name, amount, timestamp: Date.now(), description: '🎯 Накопление: ' + goal.name, oldBalance: oldBal, newBalance: user.balance, goalId: goal.id };
        db.history.push(tx);

        if (goal.currentAmount >= goal.targetAmount) { goal.status = 'completed'; goal.completedAt = Date.now(); }

        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('bank:goalUpdated', { goal });
        emitBankUpdate();
    });

    socket.on('bank:deleteGoal', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) return;
        const goal = db.savingsGoals.find(g => g.id === data?.goalId && g.userId === userId);
        if (!goal) return;
        // Return funds if goal has balance
        if (goal.currentAmount > 0) {
            user.balance += goal.currentAmount;
            const tx = { id: genId(), type: 'savings_refund', userId: user.id, userName: user.name, amount: goal.currentAmount, timestamp: Date.now(), description: '🎯 Возврат из цели: ' + goal.name, oldBalance: user.balance - goal.currentAmount, newBalance: user.balance };
            db.history.push(tx);
        }
        db.savingsGoals = db.savingsGoals.filter(g => g.id !== goal.id);
        saveDB();
        socket.emit('bank:goalDeleted', { goalId: goal.id });
        emitBankUpdate();
    });

    // ==================== EARLY DEPOSIT CLOSURE ====================

    socket.on('bank:closeDeposit', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const dep = db.userBankDeposits.find(d => d.id === data?.depositId && d.userId === userId && d.status === 'active');
        if (!dep) { socket.emit('error', { message: 'Депозит не найден.' }); return; }

        const now = Date.now();
        const totalDuration = dep.endDate - dep.startDate;
        const elapsed = now - dep.startDate;
        const progressRatio = Math.min(1, elapsed / totalDuration);

        // Penalty: lose proportional part of expected income
        let penalty = 0;
        let actualIncome = 0;
        if (progressRatio < 1) {
            // Early closure: get only 30% of proportional income
            const proportionalIncome = Math.round(dep.expectedIncome * progressRatio);
            penalty = Math.round(proportionalIncome * 0.7);
            actualIncome = proportionalIncome - penalty;
        } else {
            actualIncome = dep.expectedIncome;
        }

        const returnAmount = dep.amount + actualIncome;
        const oldBal = user.balance;
        user.balance += returnAmount;
        touchUser(user);

        dep.status = progressRatio >= 1 ? 'completed' : 'closed_early';
        dep.completedAt = now;
        dep.penalty = penalty;
        dep.actualIncome = actualIncome;

        const bank = (db.virtualBanks || []).find(b => b.id === dep.bankId);
        const tx = { id: genId(), type: 'bank_deposit_close', userId: user.id, userName: user.name, amount: returnAmount, timestamp: now, description: (progressRatio >= 1 ? '✅ Закрытие депозита' : '⚠️ Досрочное закрытие') + ': ' + (bank ? bank.name : dep.bankId), oldBalance: oldBal, newBalance: user.balance, depositId: dep.id, penalty };
        db.history.push(tx);
        db.bankHistory.push({ id: genId(), userId: user.id, type: progressRatio >= 1 ? 'deposit_close' : 'deposit_early_close', bankId: dep.bankId, amount: dep.amount, returnAmount, income: actualIncome, penalty, timestamp: now });

        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('bank:depositClosed', { deposit: dep, returnAmount, penalty, actualIncome });
        emitBankUpdate();
    });

    // ==================== BANK QUESTS (Asian Bank) ====================

    socket.on('bank:getQuests', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        // Default bank quests if none exist
        if (db.bankQuests.length === 0) {
            db.bankQuests = [
                { id: genId(), title: 'Первый депозит', description: 'Откройте свой первый депозит в любом банке', reward: 500, icon: '🏦', condition: 'first_deposit', active: true },
                { id: genId(), title: 'Активный вкладчик', description: 'Откройте 3 депозита', reward: 1000, icon: '💰', condition: 'three_deposits', active: true },
                { id: genId(), title: 'Инвестор', description: 'Сделайте первую инвестицию', reward: 750, icon: '📈', condition: 'first_investment', active: true },
                { id: genId(), title: 'Накопитель', description: 'Создайте цель накопления', reward: 300, icon: '🎯', condition: 'savings_goal', active: true },
                { id: genId(), title: 'Диверсификация', description: 'Используйте все 4 банка', reward: 2000, icon: '🌟', condition: 'all_banks', active: true }
            ];
            saveDB();
        }
        // Check which quests user has completed
        const userDeps = db.userBankDeposits.filter(d => d.userId === userId);
        const userInvs = db.userBankInvestments.filter(i => i.userId === userId);
        const userGoals = db.savingsGoals.filter(g => g.userId === userId);
        const usedBanks = new Set([...userDeps.map(d => d.bankId), ...userInvs.map(i => i.bankId)]);

        const quests = db.bankQuests.filter(q => q.active).map(q => {
            let completed = false;
            switch (q.condition) {
                case 'first_deposit': completed = userDeps.length >= 1; break;
                case 'three_deposits': completed = userDeps.length >= 3; break;
                case 'first_investment': completed = userInvs.length >= 1; break;
                case 'savings_goal': completed = userGoals.length >= 1; break;
                case 'all_banks': completed = usedBanks.size >= 4; break;
            }
            return { ...q, completed };
        });
        socket.emit('bank:quests', { quests });
    });

    socket.on('bank:claimQuest', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('error', { message: 'Не авторизован.' }); return; }
        const quest = db.bankQuests.find(q => q.id === data?.questId);
        if (!quest || !quest.active) { socket.emit('error', { message: 'Квест не найден.' }); return; }
        // Check if already claimed
        if (!db.bankHistory) db.bankHistory = [];
        const claimed = db.bankHistory.find(h => h.userId === userId && h.type === 'quest_claim' && h.questId === quest.id);
        if (claimed) { socket.emit('error', { message: 'Награда уже получена.' }); return; }

        const oldBal = user.balance;
        user.balance += quest.reward;
        touchUser(user);

        const tx = { id: genId(), type: 'bank_quest_reward', userId: user.id, userName: user.name, amount: quest.reward, timestamp: Date.now(), description: '🏆 Квест банка: ' + quest.title, oldBalance: oldBal, newBalance: user.balance };
        db.history.push(tx);
        db.bankHistory.push({ id: genId(), userId: user.id, type: 'quest_claim', questId: quest.id, amount: quest.reward, timestamp: Date.now() });
        saveDB();
        socket.emit('transaction:new', tx);
        socket.emit('bank:questClaimed', { questId: quest.id, reward: quest.reward });
        emitBankUpdate();
    });

    // ==================== BATTLE PASS / SEASON SYSTEM ====================

    socket.on('battlepass:getState', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        // Initialize season end if not set
        if (!db.battlePass.seasonEnd) {
            const d = new Date();
            db.battlePass.seasonEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
            saveDB();
        }
        // Initialize user progress if not exists
        if (!db.battlePass.userProgress[userId]) {
            db.battlePass.userProgress[userId] = {
                level: 1, xp: 0, points: 0,
                claimedLevels: [],
                unlockedTitles: ['Новичок'],
                unlockedColors: ['base'],
                unlockedIcons: ['🎓'],
                currentTitle: 'Новичок',
                currentColor: 'base',
                currentIcon: '🎓'
            };
            saveDB();
        }
        const ux = db.userXP[userId] || { xp: 0, level: 1 };
        const bp = db.battlePass.userProgress[userId];
        // Sync XP from main system
        bp.xp = ux.xp;
        bp.level = ux.level;
        socket.emit('battlepass:state', {
            seasonEnd: db.battlePass.seasonEnd,
            progress: bp,
            xp: ux
        });
    });

    socket.on('battlepass:claimReward', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const level = Number(data?.level);
        if (!level || level < 1 || level > 10) return;
        const bp = db.battlePass.userProgress[userId];
        if (!bp) return;
        if (bp.level < level || bp.claimedLevels.includes(level)) return;
        const REWARDS = {
            1: { points: 0, title: null, color: null, icon: null },
            2: { points: 150, title: 'Ученик', color: null, icon: '🐲' },
            3: { points: 0, title: 'Продвинутый', color: 'neon', icon: null },
            4: { points: 250, title: null, color: null, icon: null },
            5: { points: 0, title: 'Опытный', color: null, icon: '⚡' },
            6: { points: 300, title: null, color: 'violet', icon: null },
            7: { points: 0, title: 'Эксперт', color: null, icon: null },
            8: { points: 350, title: null, color: 'gold', icon: '👑' },
            9: { points: 400, title: 'Мастер', color: null, icon: null },
            10: { points: 500, title: 'Профессионал', color: null, icon: '🐉' }
        };
        const r = REWARDS[level];
        if (!r) return;
        if (r.points) bp.points += r.points;
        if (r.title && !bp.unlockedTitles.includes(r.title)) bp.unlockedTitles.push(r.title);
        if (r.color && !bp.unlockedColors.includes(r.color)) bp.unlockedColors.push(r.color);
        if (r.icon && !bp.unlockedIcons.includes(r.icon)) bp.unlockedIcons.push(r.icon);
        bp.claimedLevels.push(level);
        saveDB();
        socket.emit('battlepass:rewardClaimed', { level, progress: bp });
    });

    socket.on('battlepass:customize', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return;
        const bp = db.battlePass.userProgress[userId];
        if (!bp) return;
        if (data?.title && bp.unlockedTitles.includes(data.title)) bp.currentTitle = data.title;
        if (data?.color && bp.unlockedColors.includes(data.color)) bp.currentColor = data.color;
        if (data?.icon && bp.unlockedIcons.includes(data.icon)) bp.currentIcon = data.icon;
        saveDB();
        socket.emit('battlepass:customized', { progress: bp });
    });

    socket.on('admin:bpGrantXP', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetId = data?.targetId;
        const xpAmount = Number(data?.xp) || 0;
        const pointsAmount = Number(data?.points) || 0;
        if (!targetId || (xpAmount <= 0 && pointsAmount <= 0)) return;
        const result = addXP(targetId, xpAmount, 'admin_grant');
        const bp = db.battlePass.userProgress[targetId];
        if (bp && pointsAmount > 0) {
            bp.points += pointsAmount;
            saveDB();
        }
        socket.emit('admin:bpGrantResult', { targetId, xp: result.xp, level: result.level });
        emitBankUpdate();
    });

    socket.on('admin:bpLevelUp', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetId = data?.targetId;
        if (!targetId) return;
        const bp = db.battlePass.userProgress[targetId];
        if (!bp || bp.level >= 10) return;
        bp.level += 1;
        bp.xp = 0;
        // Also update main XP system
        if (!db.userXP[targetId]) db.userXP[targetId] = { xp: 0, level: 1 };
        db.userXP[targetId].level = bp.level;
        db.userXP[targetId].xp = 0;
        saveDB();
        socket.emit('admin:bpLevelUpResult', { targetId, level: bp.level });
        emitBankUpdate();
    });

    socket.on('admin:bpAssignTitle', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const targetId = data?.targetId;
        const title = data?.title;
        if (!targetId || !title) return;
        const bp = db.battlePass.userProgress[targetId];
        if (!bp) return;
        if (!bp.unlockedTitles.includes(title)) bp.unlockedTitles.push(title);
        bp.currentTitle = title;
        saveDB();
        socket.emit('admin:bpTitleResult', { targetId, title });
    });

    // ==================== ADMIN QR TERMINAL ====================
    socket.on('admin:qrExecute', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        try {
            const result = executeQrAction(data?.operation, data?.targetUserId, data?.params, 'terminal');
            saveDB(); emitBankUpdate();
            socket.emit('admin:qrExecuteResult', result);
        } catch (e) {
            socket.emit('admin:qrExecuteResult', { success: false, error: e.message, operation: data?.operation });
        }
    });

    socket.on('admin:qrGetFullUser', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const target = findUser(data?.targetUserId);
        if (!target) { socket.emit('admin:qrFullUserResult', { success: false }); return; }
        const ux = db.userXP[target.id] || { xp: 0, level: 1 };
        const userInvestments = db.investments.filter(i => i.userId === target.id && i.status === 'active');
        const userDeposits = (db.userBankDeposits || []).filter(d => d.userId === target.id && d.status === 'active');
        socket.emit('admin:qrFullUserResult', { success: true, user: { id: target.id, name: target.name, avatar: target.avatar, balance: target.balance, level: ux.level, xp: ux.xp, customTitle: target.customTitle || '', points: ux.xp, investmentCount: userInvestments.length, depositCount: userDeposits.length } });
    });

    // --- Journal / Diary (Журнал преподавателя и дневник ученика) ---
    function findJournalStudentForUser(user) {
        if (!user) return null;
        const j = getJournalData();
        return j.students.find(s => s.userId === user.id || s.id === user.id || s.name === user.name) || null;
    }

    function publicJournalFor(socketId) {
        const j = getJournalData();
        const admin = isAdmin(socketId);
        if (admin) {
            return { groups: j.groups, students: j.students, records: j.records, settings: j.settings, homework: j.homework, homeworkSubmissions: j.homeworkSubmissions, isAdmin: true };
        }
        const userId = socketUserMap.get(socketId);
        const user = findUser(userId);
        const st = findJournalStudentForUser(user);
        const myId = st ? st.id : null;
        const myGroupId = st ? st.groupId : null;
        return {
            groups: j.groups,
            students: st ? [st] : [],
            records: myId ? j.records.filter(r => r.studentId === myId) : [],
            settings: j.settings,
            homework: j.homework.filter(h => {
                if (!h) return false;
                if (myId && h.studentId) return h.studentId === myId;
                return !h.studentId && myGroupId && h.groupId === myGroupId;
            }),
            homeworkSubmissions: myId ? j.homeworkSubmissions.filter(s => s && s.studentId === myId) : [],
            isAdmin: false
        };
    }

    function emitJournalUpdate() {
        for (const socketId of socketUserMap.keys()) {
            io.to(socketId).emit('journal:updated', publicJournalFor(socketId));
        }
    }

    socket.on('journal:get', () => {
        const userId = socketUserMap.get(socket.id);
        if (!userId && !isAdmin(socket.id)) {
            socket.emit('journal:updated', { groups: [], students: [], records: [], settings: { reward: 300 }, isAdmin: false });
            return;
        }
        // Администратору — заодно сверить начисления (добивает баллы за ранее
        // сохранённые оценки, по которым начисление ещё не проходило).
        if (isAdmin(socket.id)) {
            const awarded = syncJournalAwards();
            if (awarded.length) {
                saveDB();
                emitBankUpdate();
            }
        }
        socket.emit('journal:updated', publicJournalFor(socket.id));
    });

    socket.on('journal:save', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', { message: 'Журнал доступен только администратору.' });
            return;
        }
        if (!data || typeof data !== 'object') return;
        const j = getJournalData();

        if (Array.isArray(data.groups)) j.groups = data.groups;
        if (Array.isArray(data.students)) {
            const prevTokens = new Map(j.students.map(s => [s.id, s.parentToken]));
            j.students = data.students.map(s => {
                const token = (s && s.parentToken) || prevTokens.get(s.id) || null;
                return token ? Object.assign({}, s, { parentToken: token }) : s;
            });
        }
        if (Array.isArray(data.records)) j.records = data.records;
        if (Array.isArray(data.attendance)) j.attendance = data.attendance;
        if (data.settings && typeof data.settings === 'object') {
            j.settings = { reward: Number(data.settings.reward) || 0 };
        }

        // Явные ссылки на аккаунты Bank Mandarin Pro, пришедшие с клиента
        if (Array.isArray(data.links)) {
            for (const link of data.links) {
                if (!link || !link.studentId || !link.userId) continue;
                const st = j.students.find(s => s.id === link.studentId);
                if (st && !st.userId) st.userId = link.userId;
            }
        }

        const awarded = syncJournalAwards();

        saveDB();
        emitJournalUpdate();
        if (awarded.length) {
            for (const a of awarded) {
                logAdminAction('journal_award', a.userId, a.name, a.points, 'Оценка в журнале', null);
            }
        }
        // Всегда обновляем балансы — чтобы вкладка «Офлайн» сразу показала новые суммы
        emitBankUpdate();
        socket.emit('journal:saved', { ok: true, awarded, total: awarded.reduce((s, a) => s + a.points, 0) });
    });

    // Прямое зачисление денег за оценку (клиент передаёт userId аккаунта явно)
    socket.on('journal:credit', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('error', { message: 'Журнал доступен только администратору.' });
            return;
        }
        const userId = data?.userId;
        const amount = Number(data?.amount) || 0;
        const key = String(data?.key || '');
        const reason = String(data?.reason || 'Оценка в журнале');
        if (!userId || !amount) {
            socket.emit('journal:creditResult', { ok: false, error: 'Нет userId или суммы' });
            return;
        }
        const user = findUser(userId);
        if (!user) {
            socket.emit('journal:creditResult', { ok: false, error: 'Пользователь не найден' });
            return;
        }
        const j = getJournalData();
        if (key) {
            const already = Number(j.awards[key]) || 0;
            // awards[key] хранит фактически начисленную сумму
            const delta = amount - already;
            if (!delta) {
                socket.emit('journal:creditResult', { ok: true, skipped: true, already });
                return;
            }
            const oldBal = user.balance;
            user.balance += delta;
            touchUser(user);
            j.awards[key] = amount;
            const tx = {
                id: genId(), type: 'journal_reward', userId: user.id, userName: user.name,
                amount: delta, timestamp: Date.now(),
                description: '📖 ' + reason + (delta !== amount ? ' (корректировка)' : ''),
                oldBalance: oldBal, newBalance: user.balance
            };
            db.history.push(tx);
            emitToUser(user.id, 'transaction:new', tx);
            saveDB();
            emitBankUpdate();
            socket.emit('journal:creditResult', { ok: true, userId: user.id, name: user.name, points: delta, balance: user.balance });
            return;
        }
        const oldBal = user.balance;
        user.balance += amount;
        touchUser(user);
        const tx = {
            id: genId(), type: 'journal_reward', userId: user.id, userName: user.name,
            amount, timestamp: Date.now(),
            description: '📖 ' + reason,
            oldBalance: oldBal, newBalance: user.balance
        };
        db.history.push(tx);
        emitToUser(user.id, 'transaction:new', tx);
        saveDB();
        emitBankUpdate();
        socket.emit('journal:creditResult', { ok: true, userId: user.id, name: user.name, points: amount, balance: user.balance });
    });

    // --- Журнал учеников: список, посещаемость, ссылка для родителей ---
    socket.on('admin:studentJournal:list', () => {
        if (!isAdmin(socket.id)) {
            socket.emit('admin:studentJournal:listResult', { ok: false, error: 'Требуется доступ администратора.' });
            return;
        }
        const j = getJournalData();
        const items = j.students.map(s => {
            const group = (j.groups || []).find(g => g.id === s.groupId) || null;
            const att = (j.attendance || []).filter(a => a && a.studentId === s.id);
            const recs = (j.records || []).filter(r => r && r.studentId === s.id);
            let user = null;
            if (s.userId) user = findUser(s.userId);
            if (!user && s.name) user = findUserByName(s.name) || null;
            return {
                id: s.id,
                name: s.name,
                groupId: s.groupId || null,
                groupName: group ? group.name : 'Без группы',
                userId: user ? user.id : (s.userId || null),
                balance: user ? Number(user.balance) || 0 : null,
                hasParentToken: !!s.parentToken,
                attendanceCount: att.length,
                recordCount: recs.length
            };
        });
        socket.emit('admin:studentJournal:listResult', {
            ok: true,
            students: items,
            groups: j.groups || [],
            attendance: j.attendance || []
        });
    });

    socket.on('admin:studentJournal:detail', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('admin:studentJournal:detailResult', { ok: false, error: 'Требуется доступ администратора.' });
            return;
        }
        const j = getJournalData();
        const st = j.students.find(s => s.id === data?.studentId);
        if (!st) {
            socket.emit('admin:studentJournal:detailResult', { ok: false, error: 'Ученик не найден' });
            return;
        }
        const group = (j.groups || []).find(g => g.id === st.groupId) || null;
        const records = (j.records || [])
            .filter(r => r && r.studentId === st.id)
            .slice()
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        const attendance = (j.attendance || [])
            .filter(a => a && a.studentId === st.id)
            .slice()
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        let user = null;
        if (st.userId) user = findUser(st.userId);
        if (!user && st.name) user = findUserByName(st.name) || null;
        socket.emit('admin:studentJournal:detailResult', {
            ok: true,
            student: {
                id: st.id,
                name: st.name,
                groupId: st.groupId || null,
                groupName: group ? group.name : 'Без группы',
                userId: user ? user.id : (st.userId || null),
                balance: user ? Number(user.balance) || 0 : null,
                parentToken: st.parentToken || null
            },
            records,
            attendance,
            attendanceStats: studentAttendanceStats(attendance)
        });
    });

    socket.on('admin:studentJournal:setAttendance', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('admin:studentJournal:attendanceResult', { ok: false, error: 'Требуется доступ администратора.' });
            return;
        }
        const studentId = String(data?.studentId || '');
        const date = String(data?.date || '');
        const status = String(data?.status || '');
        const note = String(data?.note || '').slice(0, 250);
        const allowed = ['present', 'absent', 'late', 'excused'];
        if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !allowed.includes(status)) {
            socket.emit('admin:studentJournal:attendanceResult', { ok: false, error: 'Некорректные данные посещаемости' });
            return;
        }
        const j = getJournalData();
        const st = j.students.find(s => s.id === studentId);
        if (!st) {
            socket.emit('admin:studentJournal:attendanceResult', { ok: false, error: 'Ученик не найден' });
            return;
        }
        const existing = j.attendance.find(a => a && a.studentId === studentId && a.date === date);
        if (existing) {
            existing.status = status;
            existing.note = note;
            existing.updatedAt = Date.now();
        } else {
            j.attendance.push({
                id: genId(),
                studentId,
                date,
                status,
                note,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }
        saveDB();
        const list = j.attendance.filter(a => a && a.studentId === studentId)
            .slice()
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        socket.emit('admin:studentJournal:attendanceResult', {
            ok: true,
            studentId,
            attendance: list,
            attendanceStats: studentAttendanceStats(list)
        });
    });

    socket.on('admin:studentJournal:parentToken', (data) => {
        if (!isAdmin(socket.id)) {
            socket.emit('admin:studentJournal:parentTokenResult', { ok: false, error: 'Требуется доступ администратора.' });
            return;
        }
        const j = getJournalData();
        const st = j.students.find(s => s.id === data?.studentId);
        if (!st) {
            socket.emit('admin:studentJournal:parentTokenResult', { ok: false, error: 'Ученик не найден' });
            return;
        }
        const regenerate = !!(data && data.regenerate);
        if (regenerate || !st.parentToken) {
            st.parentToken = generateParentToken();
            saveDB();
        }
        logAdminAction('parent_token', st.userId || st.id, st.name, null, null, regenerate ? 'Перевыпуск ссылки для родителей' : 'Создана ссылка для родителей');
        socket.emit('admin:studentJournal:parentTokenResult', {
            ok: true,
            studentId: st.id,
            parentToken: st.parentToken
        });
    });

    // ==================== HOMEWORK + GLOBAL MODE + PARTY ====================
    socket.on('homework:save', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('homework:saved', { ok: false, error: 'ДЗ доступно только администратору.' }); return; }
        if (!data || !data.groupId || !data.date) { socket.emit('homework:saved', { ok: false, error: 'Нужны groupId и date' }); return; }
        const j = getJournalData();
        const groupId = String(data.groupId);
        const date = String(data.date);
        const text = String(data.text == null ? '' : data.text).slice(0, 20000);
        const studentId = data.studentId ? String(data.studentId) : null;
        const nowIso = new Date().toISOString();
        // Правка существующего: дата публикации не меняется
        if (data.id) {
            const existing = j.homework.find(h => h && h.id === String(data.id));
            if (!existing) { socket.emit('homework:saved', { ok: false, error: 'Задание не найдено.' }); return; }
            if (existing.originalText == null) existing.originalText = existing.text || '';
            existing.text = text;
            existing.studentId = studentId;
            existing.updatedAt = nowIso;
            existing.editedAt = nowIso;
            saveDB();
            emitJournalUpdate();
            socket.emit('homework:saved', { ok: true, groupId, date, id: existing.id, edited: true });
            return;
        }
        // Новая публикация — всегда новая запись (старое уходит в историю)
        const entry = { id: genId(), groupId, studentId, date, text, createdAt: nowIso, updatedAt: nowIso };
        j.homework.push(entry);
        saveDB();
        emitJournalUpdate();
        socket.emit('homework:saved', { ok: true, groupId, date, id: entry.id });
    });

    socket.on('homework:delete', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('homework:deleted', { ok: false, error: 'Удаление доступно только администратору.' }); return; }
        if (!data || !data.id) { socket.emit('homework:deleted', { ok: false, error: 'Нужен id задания' }); return; }
        const j = getJournalData();
        const idx = j.homework.findIndex(h => h && h.id === String(data.id));
        if (idx < 0) { socket.emit('homework:deleted', { ok: false, error: 'Задание не найдено.' }); return; }
        j.homework.splice(idx, 1);
        saveDB();
        emitJournalUpdate();
        socket.emit('homework:deleted', { ok: true, id: String(data.id) });
    });

    socket.on('homework:submit', (data) => {
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user) { socket.emit('homework:submitted', { ok: false, error: 'Не авторизован.' }); return; }
        if (!data || !data.homeworkId) { socket.emit('homework:submitted', { ok: false, error: 'Нужен homeworkId' }); return; }
        const j = getJournalData();
        const hw = j.homework.find(h => h && h.id === data.homeworkId);
        if (!hw) { socket.emit('homework:submitted', { ok: false, error: 'Задание не найдено.' }); return; }
        const st = (j.students || []).find(s => s && (s.userId === user.id || s.id === user.id || s.name === user.name));
        const allowed = hw.studentId
            ? (st && st.id === hw.studentId)
            : (st && st.groupId === hw.groupId);
        if (!st || !allowed) { socket.emit('homework:submitted', { ok: false, error: 'Задание не для вас.' }); return; }
        const answer = String(data.answer == null ? '' : data.answer).slice(0, 20000);
        if (!answer.trim()) { socket.emit('homework:submitted', { ok: false, error: 'Введите ответ.' }); return; }
        const nowIso = new Date().toISOString();
        let sub = j.homeworkSubmissions.find(s => s && s.homeworkId === hw.id && s.studentId === st.id);
        if (sub) {
            if (sub.status && sub.status !== 'pending') { socket.emit('homework:submitted', { ok: false, error: 'Задание уже проверено.' }); return; }
            if (!Array.isArray(sub.answers)) sub.answers = sub.answer ? [{ text: String(sub.answer), at: sub.createdAt || nowIso }] : [];
            sub.answers.push({ text: answer, at: nowIso });
            sub.answer = answer;
            sub.updatedAt = nowIso;
        } else {
            sub = {
                id: genId(), homeworkId: hw.id, studentId: st.id, userId: user.id,
                studentName: st.name || user.name, groupId: hw.groupId,
                groupName: (j.groups.find(g => g && g.id === hw.groupId) || {}).name || '',
                hwDate: hw.date, hwText: hw.text || '', answer,
                answers: [{ text: answer, at: nowIso }],
                status: 'pending', adminComment: '',
                createdAt: nowIso, updatedAt: nowIso, reviewedAt: null
            };
            j.homeworkSubmissions.push(sub);
        }
        saveDB();
        emitJournalUpdate();
        socket.emit('homework:submitted', { ok: true, submission: sub });
    });

    socket.on('homework:review', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('homework:reviewed', { ok: false, error: 'Требуется администратор.' }); return; }
        if (!data || !data.submissionId || !data.status) { socket.emit('homework:reviewed', { ok: false, error: 'Нужны submissionId и status' }); return; }
        const status = data.status === 'approved' ? 'approved' : 'rejected';
        const j = getJournalData();
        const sub = j.homeworkSubmissions.find(s => s && s.id === data.submissionId);
        if (!sub) { socket.emit('homework:reviewed', { ok: false, error: 'Ответ не найден.' }); return; }
        sub.status = status;
        sub.adminComment = String(data.comment == null ? '' : data.comment).slice(0, 1000);
        sub.reviewedAt = new Date().toISOString();
        sub.updatedAt = sub.reviewedAt;
        saveDB();
        emitJournalUpdate();
        socket.emit('homework:reviewed', { ok: true, submission: sub });
    });

    // ==================== EXAMS / TESTS (Mandarin Pro) ====================
    socket.on('exams:get', () => {
        const ex = getExamsData();
        const userId = socketUserMap.get(socket.id);
        const admin = isAdmin(socket.id);
        if (!userId && !admin) {
            socket.emit('exams:updated', { exams: [], attempts: [], isAdmin: false });
            return;
        }
        if (admin) {
            socket.emit('exams:updated', {
                exams: ex.exams,
                attempts: ex.attempts,
                students: getJournalData().students.map(s => ({ id: s.id, name: s.name, groupId: s.groupId, userId: s.userId || null })),
                groups: getAllGroups().map(g => ({ id: g.id, name: g.name })),
                isAdmin: true
            });
            return;
        }
        const myAttempts = ex.attempts.filter(a => a && (a.userId === userId || (a.studentId && findJournalStudentByUser(userId) && a.studentId === findJournalStudentByUser(userId).id)));
        const stForVis = findJournalStudentByUser(userId);
        const openExams = ex.exams.filter(e => isExamVisibleToStudent(e, userId, stForVis));
        socket.emit('exams:updated', {
            exams: openExams.map(e => publicExamForStudent(e)),
            attempts: myAttempts.map(a => publicAttemptForStudent(a)),
            isAdmin: false
        });
    });

    socket.on('exams:save', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('exams:saved', { ok: false, error: 'Экзамены доступны только администратору.' }); return; }
        if (!data || typeof data !== 'object') return;
        const ex = getExamsData();
        const err = validateExam(data);
        if (err.length) { socket.emit('exams:saved', { ok: false, error: err.join('\n') }); return; }
        const nowIso = new Date().toISOString();
        const exam = sanitizeExam(data);
        exam.updatedAt = nowIso;
        const idx = ex.exams.findIndex(e => e && e.id === exam.id);
        if (idx < 0) {
            exam.createdAt = nowIso;
            ex.exams.push(exam);
        } else {
            exam.createdAt = ex.exams[idx].createdAt || nowIso;
            ex.exams[idx] = exam;
        }
        saveDB();
        emitExamsUpdate();
        socket.emit('exams:saved', { ok: true, id: exam.id });
    });

    socket.on('exams:delete', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('exams:deleted', { ok: false, error: 'Требуется администратор.' }); return; }
        const ex = getExamsData();
        const id = data && data.id ? String(data.id) : '';
        const idx = ex.exams.findIndex(e => e && e.id === id);
        if (idx < 0) { socket.emit('exams:deleted', { ok: false, error: 'Экзамен не найден.' }); return; }
        ex.exams.splice(idx, 1);
        ex.attempts = ex.attempts.filter(a => a && a.examId !== id);
        saveDB();
        emitExamsUpdate();
        socket.emit('exams:deleted', { ok: true, id });
    });

    socket.on('exams:saveResult', (data) => {
        // Client submits the finished attempt; server auto-grades against the live exam.
        const userId = socketUserMap.get(socket.id);
        const user = findUser(userId);
        if (!user && !isAdmin(socket.id)) { socket.emit('exams:resultSaved', { ok: false, error: 'Не авторизован.' }); return; }
        if (!data || typeof data !== 'object') return;
        const ex = getExamsData();
        const exam = ex.exams.find(e => e && e.id === String(data.examId || ''));
        if (!exam) { socket.emit('exams:resultSaved', { ok: false, error: 'Экзамен не найден.' }); return; }
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const st = userId ? findJournalStudentByUser(userId) : null;
        const start = Number(data.start) || nowMs;
        const isFinal = data.final !== false && data.status !== 'В процессе';
        const end = isFinal ? (Number(data.end) || nowMs) : null;
        const answers = data.answers && typeof data.answers === 'object' ? data.answers : {};

        let grades = {};
        let score = 0;
        let maxScore = 0;
        if (isFinal) {
            const graded = gradeExamAnswers(exam, answers);
            grades = graded.grades;
            score = graded.score;
            maxScore = graded.maxScore;
        } else {
            maxScore = (exam.questions || []).reduce((s, q) => s + (Number(q.points) || 0), 0);
        }
        const percent = maxScore ? Math.round(score / maxScore * 1000) / 10 : 0;
        const status = !isFinal ? 'В процессе' : (percent >= Number(exam.pass || 60) ? 'Сдан' : 'Не сдан');

        const attempt = {
            id: String(data.id || genId()),
            examId: exam.id,
            examSnapshot: {
                id: exam.id,
                title: exam.title,
                pass: exam.pass,
                minutes: exam.minutes,
                reveal: exam.reveal,
                navigate: exam.navigate,
                questions: (exam.questions || []).map(q => ({
                    id: q.id, text: q.text, options: q.options, answer: q.answer,
                    points: q.points, explanation: q.explanation || ''
                }))
            },
            userId: userId || (data.userId ? String(data.userId) : null),
            studentId: st ? st.id : (data.studentId ? String(data.studentId) : null),
            studentName: (st && st.name) || (user && user.name) || String(data.studentName || ''),
            groupId: st ? st.groupId || null : null,
            start,
            end,
            deadline: Number(data.deadline) || (start + Number(exam.minutes || 20) * 60000),
            durationSec: isFinal ? Math.max(0, Math.round((end - start) / 1000)) : 0,
            answers,
            grades,
            score,
            maxScore,
            percent,
            status,
            number: Number(data.number) || (ex.attempts.filter(a => a && a.examId === exam.id && (a.userId === (userId || data.userId) || (st && a.studentId === st.id))).length + 1),
            position: Number(data.position) || 0,
            createdAt: nowIso
        };
        const existingIdx = ex.attempts.findIndex(a => a && a.id === attempt.id);
        if (existingIdx >= 0) {
            // keep createdAt / number from the original in-progress attempt
            attempt.createdAt = ex.attempts[existingIdx].createdAt || nowIso;
            if (!Number(data.number) && ex.attempts[existingIdx].number) attempt.number = ex.attempts[existingIdx].number;
            ex.attempts[existingIdx] = attempt;
        } else {
            ex.attempts.push(attempt);
        }
        saveDB();
        emitExamsUpdate();
        socket.emit('exams:resultSaved', { ok: true, attempt: publicAttemptForStudent(attempt), isAdmin: isAdmin(socket.id) });
    });

    socket.on('exams:saveAnswer', (data) => {
        const userId = socketUserMap.get(socket.id);
        if (!userId && !isAdmin(socket.id)) return;
        if (!data || !data.attemptId) return;
        const ex = getExamsData();
        let a = ex.attempts.find(x => x && x.id === String(data.attemptId));
        if (a && a.end) return;
        if (a && a.userId && userId && a.userId !== userId && !isAdmin(socket.id)) return;
        if (!a) {
            // create minimal in-progress attempt so answers are not lost
            const exam = data.examId ? ex.exams.find(e => e && e.id === String(data.examId)) : null;
            const st = userId ? findJournalStudentByUser(userId) : null;
            const user = findUser(userId);
            a = {
                id: String(data.attemptId),
                examId: exam ? exam.id : String(data.examId || ''),
                examSnapshot: exam ? {
                    id: exam.id, title: exam.title, pass: exam.pass, minutes: exam.minutes, reveal: exam.reveal, navigate: exam.navigate,
                    questions: (exam.questions || []).map(q => ({ id: q.id, text: q.text, options: q.options, answer: q.answer, points: q.points, explanation: q.explanation || '' }))
                } : { id: String(data.examId || ''), title: '', questions: [] },
                userId: userId || null,
                studentId: st ? st.id : null,
                studentName: (st && st.name) || (user && user.name) || '',
                groupId: st ? st.groupId || null : null,
                start: Number(data.start) || Date.now(),
                end: null,
                deadline: Number(data.deadline) || Date.now() + 30 * 60000,
                durationSec: 0,
                answers: {},
                grades: {},
                score: 0, maxScore: 0, percent: 0,
                status: 'В процессе',
                number: ex.attempts.filter(x => x && x.examId === (exam ? exam.id : data.examId) && x.userId === (userId || null)).length + 1,
                position: 0,
                createdAt: new Date().toISOString()
            };
            ex.attempts.push(a);
        }
        if (data.answers && typeof data.answers === 'object') a.answers = Object.assign({}, a.answers || {}, data.answers);
        if (Number.isFinite(Number(data.position))) a.position = Number(data.position);
        if (Number.isFinite(Number(data.deadline))) a.deadline = Number(data.deadline);
        saveDB();
    });

    socket.on('globalMode:get', () => {
        socket.emit('globalMode:state', publicGlobalMode());
    });

    socket.on('admin:globalMode:set', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('globalMode:setResult', { ok: false, error: 'Требуется администратор.' }); return; }
        const enabled = !!(data && data.enabled);
        const section = data && data.section ? String(data.section) : null;
        const allowed = ['home', 'history', 'purchases', 'messages', 'notifications', 'coupons', 'quests', 'tasks', 'duels', 'mafia', 'mybanks', 'battlepass', 'myqr', 'qrterminal', 'journal', 'homework', 'users', 'profile', 'diary', 'croc', 'bunker', 'exams'];
        if (enabled && (!section || !allowed.includes(section))) {
            socket.emit('globalMode:setResult', { ok: false, error: 'Неизвестный модуль.' });
            return;
        }
        const g = getGlobalMode();
        g.enabled = enabled;
        g.section = enabled ? section : null;
        g.updatedAt = Date.now();
        saveDB();
        broadcastGlobalMode();
        socket.emit('globalMode:setResult', { ok: true, globalMode: publicGlobalMode() });
    });

    // --- Party games: Крокодил / Бункер ---
    function partyModeFrom(data) {
        const mode = data && data.mode === 'bunker' ? 'bunker' : (data && data.mode === 'croc' ? 'croc' : null);
        return mode;
    }

    socket.on('party:getState', (data) => {
        const mode = partyModeFrom(data) || 'croc';
        socket.emit('party:state', partyPublicPayload(mode, socket.id));
        const uid = socketUserMap.get(socket.id);
        if (uid) partySendMyCard(mode, uid);
    });

    socket.on('party:createRoom', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        if (!mode) { socket.emit('party:error', { message: 'Неизвестная игра.' }); return; }
        const g = partyGet(mode);
        const cfg = (data && data.config) || {};
        g.status = 'lobby';
        g.lobbyOpen = true;
        g.players = [];
        g.pool = partyShuffle(g.deck);
        g.used = [];
        g.config = {
            allowNext: cfg.allowNext !== false,
            distribution: cfg.distribution === 'turn' ? 'turn' : 'all'
        };
        // Creator joins as a full player and receives a character like everyone else
        const creatorUid = socketUserMap.get(socket.id);
        if (creatorUid && !g.players.some(p => p.userId === creatorUid)) {
            const brief = partyUserBrief(creatorUid);
            g.players.push({ ...brief, card: null, joinedAt: Date.now() });
        }
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:updateConfig', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        const cfg = (data && data.config) || {};
        if (cfg.allowNext !== undefined) g.config.allowNext = !!cfg.allowNext;
        if (cfg.distribution !== undefined) g.config.distribution = cfg.distribution === 'turn' ? 'turn' : 'all';
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:openRoom', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        if (g.status === 'playing') { socket.emit('party:error', { message: 'Игра уже идёт.' }); return; }
        g.status = 'lobby';
        g.lobbyOpen = true;
        if (!g.pool.length && !g.used.length) g.pool = partyShuffle(g.deck);
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:join', (data) => {
        const uid = socketUserMap.get(socket.id);
        if (!uid) { socket.emit('party:error', { message: 'Войдите в BANK MANDARIN PRO.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        if (!g.lobbyOpen && g.status !== 'playing') { socket.emit('party:error', { message: 'Комната ещё не открыта.' }); return; }
        if (g.status === 'finished') { socket.emit('party:error', { message: 'Игра завершена.' }); return; }
        if (g.players.some(p => p.userId === uid)) {
            partyEmitState(mode);
            return;
        }
        const brief = partyUserBrief(uid);
        g.players.push({ ...brief, card: null, joinedAt: Date.now() });
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:leave', (data) => {
        const uid = socketUserMap.get(socket.id);
        if (!uid) return;
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        if (g.status === 'playing') {
            const p = g.players.find(x => x.userId === uid);
            if (p && p.card) { socket.emit('party:error', { message: 'Нельзя выйти во время игры с карточкой.' }); return; }
        }
        g.players = g.players.filter(p => p.userId !== uid);
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:removePlayer', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        const target = data && data.userId;
        g.players = g.players.filter(p => p.userId !== target);
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:start', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        if (g.status === 'playing') { socket.emit('party:error', { message: 'Игра уже идёт.' }); return; }
        if (!g.players.length) { socket.emit('party:error', { message: 'Добавьте участников.' }); return; }
        if (!g.pool.length) g.pool = partyShuffle(g.deck);
        if (g.config.distribution === 'all' && g.pool.length < g.players.length) {
            socket.emit('party:error', { message: 'В колоде недостаточно персонажей.' });
            return;
        }
        g.status = 'playing';
        g.lobbyOpen = false;
        if (g.config.distribution === 'all') {
            for (const p of g.players) {
                if (!p.card) {
                    try { p.card = partyDraw(mode); } catch (e) { break; }
                }
            }
        }
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:deal', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        try {
            partyDealTo(mode, data && data.userId);
            partyTouch(mode);
            saveDB();
            partyEmitState(mode);
        } catch (e) {
            socket.emit('party:error', { message: e.message });
        }
    });

    socket.on('party:dealPending', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        try {
            for (const p of g.players) {
                if (!p.card) partyDealTo(mode, p.userId);
            }
            partyTouch(mode);
            saveDB();
            partyEmitState(mode);
        } catch (e) {
            socket.emit('party:error', { message: e.message });
        }
    });

    socket.on('party:next', (data) => {
        const uid = socketUserMap.get(socket.id);
        if (!uid) return;
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        if (!g.config.allowNext) { socket.emit('party:error', { message: 'Смена персонажа запрещена ведущим.' }); return; }
        if (g.status !== 'playing') { socket.emit('party:error', { message: 'Игра не идёт.' }); return; }
        const p = g.players.find(x => x.userId === uid);
        if (!p) { socket.emit('party:error', { message: 'Вы не в комнате.' }); return; }
        try {
            p.card = partyDraw(mode);
            partyTouch(mode);
            saveDB();
            partySendMyCard(mode, uid);
            partyEmitState(mode);
        } catch (e) {
            socket.emit('party:error', { message: e.message });
        }
    });

    socket.on('party:reshuffle', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        const held = new Set(g.players.map(p => p.card).filter(Boolean));
        g.pool = partyShuffle(g.deck.filter(x => !held.has(x)));
        g.used = [];
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:finish', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        g.status = 'finished';
        g.players.forEach(p => { p.card = null; });
        g.pool = [];
        g.used = [];
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:restart', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        g.status = 'lobby';
        g.lobbyOpen = true;
        g.pool = partyShuffle(g.deck);
        g.used = [];
        g.players.forEach(p => { p.card = null; });
        partyTouch(mode);
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:closeRoom', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        const fresh = partyDefaultGame(mode);
        db.party[mode] = fresh;
        saveDB();
        partyEmitState(mode);
    });

    socket.on('party:deckGet', (data) => {
        const mode = partyModeFrom(data) || 'croc';
        const g = partyGet(mode);
        if (!g) return;
        const adm = isAdmin(socket.id);
        socket.emit('party:deck', { mode, cards: adm ? g.deck.slice() : g.deck.length, canEdit: adm });
    });

    socket.on('party:deckSave', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        const cards = Array.isArray(data && data.cards) ? data.cards.map(x => String(x).slice(0, 100)).filter(x => x.trim()) : [];
        if (!cards.length) { socket.emit('party:error', { message: 'Колода не может быть пустой.' }); return; }
        g.deck = [...new Set(cards)];
        partyTouch(mode);
        saveDB();
        socket.emit('party:deck', { mode, cards: g.deck.slice(), canEdit: true });
        partyEmitState(mode);
    });

    socket.on('party:deckRestore', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('party:error', { message: 'Требуется администратор.' }); return; }
        const mode = partyModeFrom(data);
        const g = partyGet(mode);
        if (!g) return;
        g.deck = (PARTY_DECKS[mode] || []).slice();
        partyTouch(mode);
        saveDB();
        socket.emit('party:deck', { mode, cards: g.deck.slice(), canEdit: true });
        partyEmitState(mode);
    });

    // ==================== MAFIA MODULE (socket handlers) ====================
    socket.on('mafia:getState', () => {
        const m = mafiaEnsure();
        const uid = socketUserMap.get(socket.id);
        socket.emit('mafia:state', mafiaPublicPayload(socket.id));
        if (uid && m.game) mafiaSendMyRole(uid);
    });

    socket.on('mafia:createRoom', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const m = mafiaEnsure();
        const cfg = data?.config || {};
        m.status = 'lobby';
        m.lobbyOpen = true;
        m.joined = [];
        m.game = null;
        m.config = {
            doctor: cfg.doctor !== false,
            commissar: cfg.commissar !== false,
            mafiaMode: cfg.mafiaMode === 'fixed' ? 'fixed' : 'auto',
            mafiaCount: Math.max(1, Math.min(10, Number(cfg.mafiaCount) || 1)),
            duration: [60, 90, 120].includes(Number(cfg.duration)) ? Number(cfg.duration) : 90,
            allowHostFinish: cfg.allowHostFinish !== false,
            hostMode: ['host', 'player', 'both'].includes(cfg.hostMode) ? cfg.hostMode : 'both'
        };
        mafiaTouchVersion();
        emitMafiaState();
    });

    socket.on('mafia:updateConfig', (data) => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const m = mafiaEnsure();
        if (m.status === 'playing') { socket.emit('error', { message: 'Настройки зафиксированы после начала партии.' }); return; }
        const cfg = data?.config || {};
        if (cfg.doctor !== undefined) m.config.doctor = !!cfg.doctor;
        if (cfg.commissar !== undefined) m.config.commissar = !!cfg.commissar;
        if (cfg.mafiaMode !== undefined) m.config.mafiaMode = cfg.mafiaMode === 'fixed' ? 'fixed' : 'auto';
        if (cfg.mafiaCount !== undefined) m.config.mafiaCount = Math.max(1, Math.min(10, Number(cfg.mafiaCount) || 1));
        if (cfg.duration !== undefined && [60, 90, 120].includes(Number(cfg.duration))) m.config.duration = Number(cfg.duration);
        if (cfg.allowHostFinish !== undefined) m.config.allowHostFinish = !!cfg.allowHostFinish;
        if (cfg.hostMode !== undefined && ['host', 'player', 'both'].includes(cfg.hostMode)) m.config.hostMode = cfg.hostMode;
        mafiaTouchVersion();
        emitMafiaState();
    });

    socket.on('mafia:openRoom', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const m = mafiaEnsure();
        if (m.status === 'playing') { socket.emit('error', { message: 'Партия уже идёт.' }); return; }
        m.status = 'lobby';
        m.lobbyOpen = true;
        mafiaTouchVersion();
        emitMafiaState();
    });

    socket.on('mafia:join', () => {
        const uid = socketUserMap.get(socket.id);
        if (!uid) { socket.emit('error', { message: 'Войдите в BANK MANDARIN PRO.' }); return; }
        const m = mafiaEnsure();
        const realDeal = m.status === 'playing' && m.game && Array.isArray(m.game.players) && m.game.players.some(p => p && p.userId);
        if (realDeal) { socket.emit('error', { message: 'Партия уже началась.' }); return; }
        if (m.status === 'playing') {
            // Stale/phantom game with no real players — reset to lobby so people can join
            m.status = 'lobby';
            m.game = null;
            m.lobbyOpen = true;
            mafiaTouchVersion();
        }
        if (!m.lobbyOpen) { socket.emit('error', { message: 'Комната ещё не открыта.' }); return; }
        if (m.joined.some(p => p.userId === uid)) {
            socket.emit('mafia:state', mafiaPublicPayload(socket.id));
            return;
        }
        const brief = mafiaUserBrief(uid);
        m.joined.push({ ...brief, joinedAt: Date.now() });
        mafiaTouchVersion();
        emitMafiaState();
    });

    socket.on('mafia:leave', () => {
        const uid = socketUserMap.get(socket.id);
        if (!uid) return;
        const m = mafiaEnsure();
        if (m.status === 'playing') { socket.emit('error', { message: 'Нельзя выйти во время партии.' }); return; }
        const before = m.joined.length;
        m.joined = m.joined.filter(p => p.userId !== uid);
        if (m.joined.length !== before) {
            mafiaTouchVersion();
            emitMafiaState();
        } else {
            socket.emit('mafia:state', mafiaPublicPayload(socket.id));
        }
    });

    socket.on('mafia:start', () => {
        if (!isAdmin(socket.id)) { socket.emit('error', { message: 'Требуется доступ администратора.' }); return; }
        const m = mafiaEnsure();
        if (m.status === 'playing') { socket.emit('error', { message: 'Партия уже идёт.' }); return; }
        if (!m.lobbyOpen) { socket.emit('error', { message: 'Сначала откройте комнату.' }); return; }
        const adminUid = socketUserMap.get(socket.id) || null;
        const hostMode = ['host', 'player', 'both'].includes(m.config.hostMode) ? m.config.hostMode : 'both';
        // In pure «Ведущий» mode the admin does not receive a player card
        let joinedList = m.joined.slice();
        if (hostMode === 'host' && adminUid) {
            joinedList = joinedList.filter(p => p.userId !== adminUid);
        }
        const n = joinedList.length;
        if (n < 4) {
            socket.emit('mafia:error', { message: 'Для партии нужно минимум 4 участника. Сейчас: ' + n + '.' });
            return;
        }
        if (n > 20) {
            socket.emit('mafia:error', { message: 'Максимум 20 участников.' });
            return;
        }
        const doctor = !!m.config.doctor;
        const commissar = !!m.config.commissar;
        const mafiaCount = m.config.mafiaMode === 'fixed'
            ? Math.max(1, Math.min(n - 2, Number(m.config.mafiaCount) || 1))
            : Math.max(1, Math.floor(n / 3));
        const extra = (doctor ? 1 : 0) + (commissar ? 1 : 0);
        const civilians = n - mafiaCount - extra;
        if (civilians < 1) {
            socket.emit('mafia:error', { message: 'Недостаточно участников для выбранных ролей. Уменьшите число мафиози или отключите спецроли.' });
            return;
        }
        const deck = [];
        for (let i = 0; i < mafiaCount; i++) deck.push('mafia');
        if (doctor) deck.push('doctor');
        if (commissar) deck.push('commissar');
        for (let i = 0; i < civilians; i++) deck.push('civilian');
        // Fisher–Yates with crypto when available
        for (let i = deck.length - 1; i > 0; i--) {
            let j;
            if (crypto?.randomInt) j = crypto.randomInt(0, i + 1);
            else j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        const players = joinedList.map((p, i) => ({
            userId: p.userId,
            name: p.name,
            photo: p.photo || null,
            role: deck[i],
            out: false
        }));
        let hostId;
        if (hostMode === 'host' && adminUid) {
            hostId = adminUid; // admin hosts only, no card
        } else if (hostMode === 'both' && adminUid) {
            hostId = adminUid; // admin hosts and plays
        } else {
            let hostIdx;
            if (crypto?.randomInt) hostIdx = crypto.randomInt(0, players.length);
            else hostIdx = Math.floor(Math.random() * players.length);
            hostId = players[hostIdx].userId;
        }
        const duration = [60, 90, 120].includes(Number(m.config.duration)) ? Number(m.config.duration) : 90;
        m.status = 'playing';
        m.game = {
            players,
            hostId,
            hostMode,
            timer: { duration, left: duration, running: false, endAt: 0 },
            startedAt: Date.now()
        };
        mafiaTouchVersion();
        emitMafiaState();
        for (const p of players) mafiaSendMyRole(p.userId);
    });

    socket.on('mafia:timer', (data) => {
        const uid = socketUserMap.get(socket.id);
        const m = mafiaEnsure();
        if (!m.game) return;
        const isHost = m.game.hostId === uid;
        if (!isHost && !isAdmin(socket.id)) return;
        const action = data?.action;
        const t = m.game.timer;
        if (action === 'set') {
            const d = Number(data.duration);
            if (![60, 90, 120].includes(d)) return;
            t.duration = d;
            t.left = d;
            t.running = false;
            t.endAt = 0;
        } else if (action === 'reset') {
            t.left = t.duration;
            t.running = false;
            t.endAt = 0;
        } else if (action === 'toggle') {
            if (t.running) {
                t.left = Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
                t.running = false;
                t.endAt = 0;
            } else {
                if (t.left <= 0) t.left = t.duration;
                t.endAt = Date.now() + t.left * 1000;
                t.running = true;
            }
        } else {
            return;
        }
        mafiaTouchVersion();
        emitMafiaState();
    });

    socket.on('mafia:exclude', (data) => {
        const uid = socketUserMap.get(socket.id);
        const m = mafiaEnsure();
        if (!m.game) return;
        const isHost = m.game.hostId === uid;
        if (!isHost && !isAdmin(socket.id)) return;
        const targetId = data?.userId;
        const p = m.game.players.find(x => x.userId === targetId);
        if (!p) return;
        p.out = data?.out === undefined ? !p.out : !!data.out;
        mafiaTouchVersion();
        emitMafiaState();
    });

    socket.on('mafia:requestRoles', () => {
        const uid = socketUserMap.get(socket.id);
        const m = mafiaEnsure();
        if (!m.game) { socket.emit('mafia:roles', { roles: [] }); return; }
        const isHost = m.game.hostId === uid;
        const isAdm = isAdmin(socket.id);
        if (!isHost && !isAdm) {
            socket.emit('mafia:roles', { roles: [], denied: true });
            return;
        }
        socket.emit('mafia:roles', {
            roles: m.game.players.map(p => ({
                userId: p.userId,
                name: p.name,
                role: p.role,
                out: !!p.out
            }))
        });
    });

    socket.on('mafia:finish', (data) => {
        const uid = socketUserMap.get(socket.id);
        const m = mafiaEnsure();
        const token = data && data.adminToken ? String(data.adminToken) : '';
        const isAdm = isAdmin(socket.id) || validateAdminSessionToken(token);
        if (isAdm) adminSockets.add(socket.id);
        const isHost = !!(m.game && m.game.hostId === uid && m.config && m.config.allowHostFinish);
        if (!isAdm && !isHost) {
            socket.emit('mafia:error', { message: 'Нет прав на завершение партии.' });
            return;
        }
        // Keep lobby members so a new round can start; drop the finished deal.
        // Admin can finish even if game is already missing (stuck / phantom state).
        m.status = 'lobby';
        m.lobbyOpen = true;
        m.game = null;
        mafiaTouchVersion();
        emitMafiaState();
    });

    socket.on('mafia:reset', (data) => {
        const token = data && data.adminToken ? String(data.adminToken) : '';
        const isAdm = isAdmin(socket.id) || validateAdminSessionToken(token);
        if (!isAdm) {
            socket.emit('mafia:error', { message: 'Требуется доступ администратора.' });
            return;
        }
        adminSockets.add(socket.id);
        const m = mafiaEnsure();
        m.status = 'idle';
        m.lobbyOpen = false;
        m.joined = [];
        m.game = null;
        m.config = getDefaultMafia().config;
        mafiaTouchVersion();
        emitMafiaState();
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
        const userId = socketUserMap.get(socket.id);
        if (userId) markUserSeen(userId);
        removeSocket(socket.id);
        emitBankUpdate();
    });
});

// Periodic cleanup: remove stale entries from lastSeenMap (memory management only)
setInterval(() => {
    const now = Date.now();
    for (const [userId, ts] of lastSeenMap.entries()) {
        if (now - ts >= ONLINE_TIMEOUT_MS) {
            lastSeenMap.delete(userId);
        }
    }
}, 10000);

const PORT = process.env.PORT || 3000;
function startHttpServer() {
    server.listen(PORT, () => {
        console.log(`MANDARIN PRO server running on http://localhost:${PORT}`);
        console.log(`[PG] HTTP listen AFTER db load. users=${db.users.length} storage=${usePg ? 'postgresql' : 'file'} _dbLoaded=${_dbLoaded}`);
    });
}

async function gracefulShutdown() {
    console.log('[PG] Shutting down, flushing data...');
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    if (_dbLoaded) {
        try {
            await saveDBImmediate();
            console.log('[PG] Data flushed on shutdown');
        } catch (err) {
            console.error('[PG] Failed to flush data on shutdown:', err.message);
            console.error(err.stack || '');
        }
    } else {
        console.error('[PG] Shutdown before DB load — skip save to prevent wiping Supabase');
    }
    if (pool) {
        try { await pool.end(); } catch (e) { console.error('[PG] Pool end error:', e.message); }
    }
    process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
