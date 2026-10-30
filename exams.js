/* Bank Mandarin Pro — модуль «Экзамены и тесты»
 * Источник: Mandarin_тесты экзамены.html
 * Хранение результатов — на сервере (socket), ID учеников — из основной программы.
 */
(function () {
    'use strict';

    var BP = null;
    var db = { exams: [], attempts: [], students: [], groups: [] };
    var isAdminMode = false;
    var page = 'exams';
    var draft = null;
    var active = null;
    var qi = 0;
    var filter = '';
    var editingQ = null;
    var editingIndex = null;
    var tickTimer = null;
    var warned = {};
    var _inDiaryPull = false;

    var STATES = ['Черновик', 'Опубликован', 'Открыт', 'Закрыт', 'Архив'];

    /* ---------- utils ---------- */
    function $(id) { return document.getElementById(id); }
    function esc(x) {
        return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function uid() {
        return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(36).slice(2);
    }
    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    function now() { return Date.now(); }
    function fmtDate(x) { return x ? new Date(x).toLocaleString('ru-RU') : '—'; }
    function toast(msg) {
        if (BP && BP.toast) { BP.toast('i', 'Экзамены', msg); return; }
        var t = $('examsToast');
        if (!t) return;
        t.textContent = msg;
        t.style.display = 'block';
        setTimeout(function () { t.style.display = 'none'; }, 3200);
    }
    function maxScore(e) {
        return (e.questions || []).reduce(function (s, q) { return s + (Number(q.points) || 0); }, 0);
    }
    function meUser() { return BP && BP.getUser ? BP.getUser() : null; }
    function myName() {
        var u = meUser();
        return u ? (u.nickname || u.name || '') : '';
    }

    /* ---------- styles (scoped) ---------- */
    var STYLES = ''
        + '.mpexams{font:15px/1.55 system-ui,-apple-system,sans-serif;color:#193b36;background:#f4f6f2;padding:16px 14px 40px;min-height:60vh;border-radius:16px}'
        + '.mpexams *{box-sizing:border-box}'
        + '.mpexams button{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-align:center;border:1px solid #d5e0d9;background:#fff;color:#193b36;border-radius:14px;padding:12px 18px;min-height:46px;font:inherit;font-weight:600;letter-spacing:.01em;box-shadow:0 1px 2px rgba(25,59,54,.06);transition:transform .12s ease,box-shadow .12s ease,background .15s ease,border-color .15s ease,color .15s ease;-webkit-tap-highlight-color:transparent;user-select:none}'
        + '.mpexams button:hover{border-color:#216c58;background:#f7fbf8;box-shadow:0 4px 12px rgba(25,59,54,.1)}'
        + '.mpexams button:active{transform:scale(.97);box-shadow:0 1px 2px rgba(25,59,54,.08)}'
        + '.mpexams button.primary{background:linear-gradient(180deg,#278266,#1c6b52);color:#fff;border-color:#1c6b52;box-shadow:0 4px 14px rgba(33,108,88,.28)}'
        + '.mpexams button.primary:hover{background:linear-gradient(180deg,#2d9272,#216c58);border-color:#216c58;box-shadow:0 6px 18px rgba(33,108,88,.35)}'
        + '.mpexams button.primary:active{background:linear-gradient(180deg,#1c6b52,#175842);transform:scale(.97);box-shadow:0 2px 8px rgba(33,108,88,.25)}'
        + '.mpexams button.danger{color:#c23b32;border-color:#efc5c1;background:#fff8f7}'
        + '.mpexams button.danger:hover{background:#ffefed;border-color:#e5a29b;color:#b3342c;box-shadow:0 4px 12px rgba(179,68,56,.12)}'
        + '.mpexams button.danger:active{background:#ffe6e2;transform:scale(.97)}'
        + '.mpexams button.ghost{background:transparent;border-color:transparent;box-shadow:none;color:#4e7564;font-weight:600}'
        + '.mpexams button.ghost:hover{background:rgba(33,108,88,.1);border-color:transparent;box-shadow:none;color:#216c58}'
        + '.mpexams button.ghost:active{background:rgba(33,108,88,.16);transform:scale(.97)}'
        + '.mpexams button:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}'
        + '.mpexams input,.mpexams select,.mpexams textarea{width:100%;border:1px solid #cdd9d0;border-radius:10px;background:#fff;padding:11px;color:#193b36;font:inherit}'
        + '.mpexams textarea{min-height:90px;resize:vertical}'
        + '.mpexams input[type=checkbox],.mpexams input[type=radio]{width:auto;accent-color:#216c58}'
        + '.mpexams label{display:block;font-size:13px;font-weight:600;margin-bottom:8px}'
        + '.mpexams label input,.mpexams label textarea,.mpexams label select{display:block;margin-top:6px}'
        + '.mpexams h1,.mpexams h2,.mpexams h3,.mpexams p{margin-top:0}'
        + '.mpexams h1{font-size:28px;letter-spacing:-1px;line-height:1.2}'
        + '.mpexams h2{font-size:21px;letter-spacing:-.5px}'
        + '.mpexams h3{font-size:17px}'
        + '.mpexams .muted{color:#70817d}'
        + '.mpexams .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}'
        + '.mpexams .between{justify-content:space-between}'
        + '.mpexams .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}'
        + '.mpexams .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}'
        + '.mpexams .panel,.mpexams .card{background:#fff;border:1px solid #e0e7df;border-radius:18px;padding:20px;margin-bottom:16px}'
        + '.mpexams .card{display:flex;flex-direction:column;margin:0}'
        + '.mpexams .card .foot{margin-top:auto;padding-top:18px}'
        + '.mpexams .pill{display:inline-block;background:#edf3ed;color:#4e7564;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700}'
        + '.mpexams .tag{font-size:11px;text-transform:uppercase;letter-spacing:1.6px;color:#216c58;font-weight:750}'
        + '.mpexams .hero{padding:24px;background:#e6eee2;border-radius:18px;margin-bottom:22px}'
        + '.mpexams .hero h1{max-width:650px;margin:10px 0}'
        + '.mpexams .hero p{max-width:650px;margin-bottom:0;color:#567060}'
        + '.mpexams .stat{font-size:30px;font-weight:750;letter-spacing:-1px}'
        + '.mpexams .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}'
        + '.mpexams .metrics>div{border-bottom:2px solid #d6e1d6;padding:10px 0}'
        + '.mpexams .note{padding:12px 14px;background:#fff6df;border-radius:12px;font-size:12px;margin:14px 0}'
        + '.mpexams .empty{text-align:center;padding:40px 16px;color:#70817d}'
        + '.mpexams .question{border:1px solid #e0e7df;padding:18px;border-radius:15px;margin:12px 0}'
        + '.mpexams .option{display:flex;gap:12px;align-items:center;border:1px solid #e0e7df;padding:14px;border-radius:12px;margin:10px 0;font-size:16px;cursor:pointer}'
        + '.mpexams .option:has(input:checked){border-color:#216c58;background:#edf5ee}'
        + '.mpexams .progress{height:7px;background:#e8eee7;border-radius:9px;overflow:hidden}'
        + '.mpexams .progress i{display:block;height:100%;background:#216c58}'
        + '.mpexams .qnav button{min-width:44px;height:44px;min-height:44px;padding:0 10px;border-radius:12px;font-weight:700;font-size:14px}'
        + '.mpexams .qnav .done{background:#dff0e4;border-color:#b7d9c2;color:#1c6b52}'
        + '.mpexams .qnav .current{border-color:#216c58;background:#fff;box-shadow:0 0 0 3px rgba(33,108,88,.18)}'
        + '.mpexams .timer{font:700 24px ui-monospace,monospace}'
        + '.mpexams .table{overflow:auto}'
        + '.mpexams table{width:100%;border-collapse:collapse;font-size:13px}'
        + '.mpexams td,.mpexams th{text-align:left;border-bottom:1px solid #e0e7df;padding:11px;white-space:nowrap}'
        + '.mpexams .error{color:#ad342b;background:#fff0ed;padding:12px;border-radius:10px;white-space:pre-wrap}'
        + '.mpexams .success{color:#216c58}'
        + '.mpexams .sticky{position:sticky;top:0;z-index:2;background:#f4f6f2;padding:10px 0}'
        + '.mpexams .split{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:18px}'
        + '.mpexams .detail{white-space:pre-wrap;overflow-wrap:anywhere}'
        + '.mpexams .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}'
        + '.mpexams .tabs button{border-radius:999px;padding:11px 18px;min-height:42px;font-weight:600;background:#e7eee8;border-color:transparent;box-shadow:none}'
        + '.mpexams .tabs button:hover{background:#dce8de;border-color:transparent;box-shadow:none}'
        + '.mpexams .tabs button.active{background:linear-gradient(180deg,#278266,#1c6b52);color:#fff;border-color:#1c6b52;font-weight:700;box-shadow:0 4px 12px rgba(33,108,88,.28)}'
        + '.mpexams .tabs button.active:hover{background:linear-gradient(180deg,#2d9272,#216c58)}'
        + '@media(max-width:900px){.mpexams .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mpexams .split{grid-template-columns:1fr}}'
        + '@media(max-width:700px){.mpexams{padding:12px 10px 28px}.mpexams .grid,.mpexams .two{grid-template-columns:1fr}.mpexams .metrics{grid-template-columns:repeat(2,1fr)}.mpexams h1{font-size:24px}.mpexams .hero{padding:18px}.mpexams .panel,.mpexams .card{padding:16px}.mpexams .row>*{max-width:100%}.mpexams .table{margin:0 -8px}}'
        + '.mpexams .exam-save-bar{position:sticky;bottom:12px;z-index:20;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;background:rgba(244,246,242,.96);border:1px solid #cdd9d0;border-radius:16px;padding:12px;margin-top:18px;box-shadow:0 8px 28px rgba(25,59,54,.12)}'
        + '.mpexams .exam-float-down,#examFloatDown{position:fixed;right:16px;bottom:88px;z-index:50;width:54px;height:54px;min-height:54px;border-radius:50%;background:linear-gradient(180deg,#278266,#1c6b52);color:#fff;border:1px solid #1c6b52;box-shadow:0 8px 24px rgba(33,108,88,.4);font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s ease,box-shadow .15s ease,background .15s ease}'
        + '.mpexams .exam-float-down:hover,#examFloatDown:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(33,108,88,.45);background:linear-gradient(180deg,#2d9272,#216c58)}'
        + '.mpexams .exam-float-down:active,#examFloatDown:active{transform:scale(.95)}'
        + '.mpexams .exam-float-down.hidden,#examFloatDown.hidden{display:none}'
        + '#examsModal .mpexams{min-height:0;background:transparent;padding:0}'
        + '.mpexams .card .foot{display:flex;flex-wrap:wrap;gap:8px}'
        + '.mpexams .card .foot button{flex:1 1 auto;min-width:110px}'
        + '@media(max-width:700px){.mpexams .exam-float-down,#examFloatDown{bottom:calc(72px + env(safe-area-inset-bottom,0px));right:12px}.mpexams .exam-save-bar{bottom:calc(8px + env(safe-area-inset-bottom,0px))}}';

    function ensureStyles() {
        if (document.getElementById('mpexamsStyles')) return;
        var st = document.createElement('style');
        st.id = 'mpexamsStyles';
        st.textContent = STYLES;
        document.head.appendChild(st);
    }

    var lastPullAt = 0;

    function fetchGroupsFromJournal() {
        try {
            if (window.Journal && window.Journal.getData) {
                var j = window.Journal.getData();
                if (j && Array.isArray(j.groups) && j.groups.length) {
                    return j.groups.map(function (g) { return { id: g.id, name: g.name }; });
                }
            }
        } catch (e) { }
        // fallback: unique groupIds from known students
        var map = {};
        (db.students || []).forEach(function (s) {
            if (s && s.groupId) map[s.groupId] = { id: s.groupId, name: s.groupName || s.groupId };
        });
        return Object.keys(map).map(function (k) { return map[k]; });
    }

    function allGroups() {
        var list = (db.groups || []).slice();
        if (!list.length) list = fetchGroupsFromJournal();
        // merge any groups only known via students
        (db.students || []).forEach(function (s) {
            if (!s || !s.groupId) return;
            if (!list.some(function (g) { return g && g.id === s.groupId; })) {
                list.push({ id: s.groupId, name: s.groupName || s.groupId });
            }
        });
        return list;
    }

    /* ---------- server sync ---------- */
    function pull() {
        if (BP && BP.examsGet) {
            lastPullAt = Date.now();
            BP.examsGet();
        }
    }

    function applyServerData(data) {
        if (!data || typeof data !== 'object') return;
        var nextExams = Array.isArray(data.exams) ? data.exams : [];
        var nextAttempts = Array.isArray(data.attempts) ? data.attempts : [];
        db.students = Array.isArray(data.students) ? data.students : db.students;
        if (Array.isArray(data.groups)) db.groups = data.groups;
        if (!db.groups || !db.groups.length) db.groups = fetchGroupsFromJournal();
        isAdminMode = !!data.isAdmin;

        // Keep the locally active in-progress attempt (answers may not have reached the server yet)
        if (active) {
            var local = findAttempt(active);
            var idx = nextAttempts.findIndex(function (x) { return x && x.id === active; });
            if (local && !local.end) {
                if (idx >= 0) {
                    var srv = nextAttempts[idx];
                    nextAttempts[idx] = Object.assign({}, srv, {
                        answers: Object.assign({}, srv.answers || {}, local.answers || {}),
                        position: local.position != null ? local.position : srv.position,
                        deadline: local.deadline || srv.deadline,
                        examSnapshot: local.examSnapshot || srv.examSnapshot
                    });
                } else {
                    nextAttempts.push(local);
                }
            }
        }

        db.exams = nextExams;
        db.attempts = nextAttempts;
        if (active) {
            var a = findAttempt(active);
            if (!a || a.end) { active = null; qi = 0; }
        }
        render();
        // refresh diary block if visible (avoid re-entrancy loop)
        try {
            if (!_inDiaryPull && window.Journal && window.Journal.renderDiary && document.getElementById('diaryRoot')) {
                var diarySec = document.getElementById('secDiary');
                if (diarySec && diarySec.classList.contains('on')) {
                    _inDiaryPull = true;
                    window.Journal.renderDiary();
                    setTimeout(function () { _inDiaryPull = false; }, 0);
                }
            }
        } catch (e) { _inDiaryPull = false; }
    }

    function saveExamToServer(exam) {
        if (BP && BP.examsSave) BP.examsSave(exam);
    }
    function saveResultToServer(attempt) {
        if (BP && BP.examsSaveResult) BP.examsSaveResult(attempt);
    }
    function saveAnswerToServer(attemptId, answers, position, extra) {
        if (BP && BP.examsSaveAnswer) {
            var payload = { attemptId: attemptId, answers: answers, position: position };
            if (extra) {
                if (extra.examId) payload.examId = extra.examId;
                if (extra.start) payload.start = extra.start;
                if (extra.deadline) payload.deadline = extra.deadline;
            }
            BP.examsSaveAnswer(payload);
        }
    }

    var pendingResultId = null;

    function onResultSaved(payload) {
        if (!payload) return;
        if (payload.ok === false) {
            toast(payload.error || 'Не удалось сохранить результат.');
            return;
        }
        var a = payload.attempt;
        if (!a) return;
        // merge server-graded attempt into local list
        var i = db.attempts.findIndex(function (x) { return x && x.id === a.id; });
        // keep full snapshot questions from local if server public snapshot is reduced
        var local = i >= 0 ? db.attempts[i] : null;
        var merged = Object.assign({}, a);
        if (local && local.examSnapshot && local.examSnapshot.questions && local.examSnapshot.questions.length) {
            merged.examSnapshot = local.examSnapshot;
        }
        // admin sees full grades
        if (payload.isAdmin && local && local.grades) {
            merged.grades = Object.assign({}, local.grades, a.grades || {});
        }
        if (i >= 0) db.attempts[i] = merged;
        else db.attempts.push(merged);
        if (pendingResultId === a.id) {
            pendingResultId = null;
            active = null;
            page = 'results';
            render();
            showResult(a.id);
        } else if (page === 'results' || page === 'exams' || page === 'progress') {
            render();
        }
    }

    /* ---------- helpers ---------- */
    function findExam(id) { return db.exams.find(function (e) { return e && e.id === id; }); }
    function findAttempt(id) { return db.attempts.find(function (a) { return a && a.id === id; }); }
    function myAttempts(examId) {
        var u = meUser();
        var uid = u ? u.id : null;
        return db.attempts.filter(function (a) {
            if (!a || a.examId !== examId) return false;
            if (uid && a.userId === uid) return true;
            if (!a.userId && a.studentName && a.studentName === myName()) return true;
            return false;
        });
    }
    function hasAnswer(v) {
        if (Array.isArray(v)) return v.some(function (x) { return String(x == null ? '' : x).trim(); });
        return String(v == null ? '' : v).trim().length > 0;
    }
    function answerUIValue(q, v) {
        // v is selected option text (or letter)
        return v;
    }
    function resolveAnswer(q) {
        var ans = String(q.answer || '').trim();
        var opts = (q.options || []).map(function (o) { return String(o || '').trim(); });
        if (!ans) return '';
        if (/^[A-Da-d]$/.test(ans)) {
            var idx = ans.toUpperCase().charCodeAt(0) - 65;
            return opts[idx] || '';
        }
        var m = ans.match(/^([A-Da-d])[.)]\s*(.*)$/);
        if (m) {
            var i2 = m[1].toUpperCase().charCodeAt(0) - 65;
            return opts[i2] || m[2] || '';
        }
        // exact option text
        for (var i = 0; i < opts.length; i++) {
            if (opts[i] === ans) return opts[i];
        }
        return ans;
    }
    function isCorrect(q, v) {
        if (!hasAnswer(v)) return false;
        var target = resolveAnswer(q);
        var val = String(Array.isArray(v) ? (v[0] || '') : v).trim();
        return val === target || val.toUpperCase() === String(q.answer || '').trim().toUpperCase() || val === String(q.answer || '').trim();
    }

    /* ---------- UI shell ---------- */
    function shell(body) {
        ensureStyles();
        var root = $('examsRoot');
        if (!root) return;
        var tabs = [];
        if (isAdminMode) {
            tabs = [['exams', 'Экзамены'], ['results', 'Результаты']];
        } else {
            tabs = [['exams', 'Доступные'], ['progress', 'В процессе'], ['results', 'Мои результаты']];
        }
        root.innerHTML = '<div class="mpexams">'
            + '<div class="tabs">' + tabs.map(function (t) {
                return '<button class="' + (page === t[0] ? 'active' : '') + '" onclick="Exams.go(\'' + t[0] + '\')">' + esc(t[1]) + '</button>';
            }).join('') + '</div>'
            + body
            + '</div><div id="examsToast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#193b36;color:#fff;padding:12px 18px;border-radius:12px;z-index:9999;max-width:90%"></div>';
    }

    function modal(html) {
        var m = $('examsModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'examsModal';
            m.style.cssText = 'position:fixed;inset:0;background:rgba(16,44,39,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px';
            document.body.appendChild(m);
        }
        m.innerHTML = '<div class="mpexams" style="background:#f4f6f2;color:#193b36;border-radius:18px;max-width:860px;width:96%;max-height:90dvh;overflow:auto;padding:20px">'
            + '<div class="row between" style="margin-bottom:14px"><span class="tag">MANDARIN PRO · ЭКЗАМЕНЫ</span>'
            + '<button class="ghost" style="min-height:62px;padding:18px 42px;font-size:18px" onclick="Exams.closeModal()">Закрыть</button></div>'
            + html + '</div>';
        m.style.display = 'flex';
    }
    function closeModal() {
        var m = $('examsModal');
        if (m) m.style.display = 'none';
    }

    /* ---------- catalog ---------- */
    function catalog() {
        var exams = isAdminMode ? db.exams : db.exams.filter(function (e) { return e && (e.state === 'Открыт' || e.state === 'Опубликован'); });
        if (page === 'progress') {
            var inProg = db.attempts.filter(function (a) { return a && !a.end; });
            exams = inProg.map(function (a) { return findExam(a.examId) || a.examSnapshot; }).filter(Boolean);
        }
        var finished = db.attempts.filter(function (a) { return a && a.end; });
        shell('<div class="hero"><span class="tag">Проверяйте знания</span>'
            + '<h1>' + (isAdminMode ? 'Экзамены и тесты' : 'Твои экзамены') + '</h1>'
            + '<p>' + (isAdminMode ? 'Создавайте экзамены и следите за результатами учеников.' : 'Выбери экзамен, прочитай инструкцию и покажи, чему ты научился.') + '</p></div>'
            + '<div class="metrics">'
            + '<div><span class="muted">' + (isAdminMode ? 'Экзаменов' : 'Доступно') + '</span><div class="stat">' + exams.length + '</div></div>'
            + '<div><span class="muted">Завершено</span><div class="stat">' + finished.length + '</div></div>'
            + '<div><span class="muted">Учеников</span><div class="stat">' + (isAdminMode ? db.students.length : myAttempts('').length) + '</div></div>'
            + '<div><span class="muted">' + (isAdminMode ? 'Попыток' : 'В процессе') + '</span><div class="stat">' + (isAdminMode ? db.attempts.length : db.attempts.filter(function (a) { return a && !a.end; }).length) + '</div></div>'
            + '</div>'
            + '<div class="row between" style="margin-bottom:16px"><h2 style="margin:0">' + (page === 'progress' ? 'В процессе' : 'Экзамены') + '</h2>'
            + (isAdminMode ? '<button class="primary" onclick="Exams.editExam()">+ Создать экзамен</button>' : '')
            + '</div>'
            + '<input placeholder="Поиск по названию или уровню…" value="' + esc(filter) + '" oninput="Exams.setFilter(this.value)" style="margin-bottom:16px">'
            + '<div class="grid" id="examsCards"></div>');
        drawCards(exams);
    }

    function drawCards(exams) {
        var box = $('examsCards');
        if (!box) return;
        var list = (exams || db.exams).filter(function (e) {
            return (String(e.title || '') + ' ' + String(e.level || '')).toLowerCase().indexOf(filter.toLowerCase()) >= 0;
        });
        if (!list.length) {
            box.innerHTML = '<div class="panel empty" style="grid-column:1/-1">Здесь пока нет экзаменов.<br>'
                + (isAdminMode ? 'Создайте первый экзамен.' : 'Преподаватель должен открыть экзамен.') + '</div>';
            return;
        }
        box.innerHTML = list.map(function (e) {
            var a = null;
            var u = meUser();
            if (u) {
                a = db.attempts.find(function (x) { return x && x.examId === e.id && x.userId === u.id && !x.end; });
            }
            var foot = '';
            if (isAdminMode) {
                foot = '<button class="primary" onclick="Exams.editExam(\'' + e.id + '\')">Редактировать</button>'
                    + '<button onclick="Exams.assignExam(\'' + e.id + '\')">Назначить</button>'
                    + '<button onclick="Exams.preview(\'' + e.id + '\')">Просмотр</button>'
                    + '<button class="danger" onclick="Exams.removeExam(\'' + e.id + '\')">Удалить</button>';
            } else if (a) {
                foot = '<button class="primary" onclick="Exams.resume(\'' + a.id + '\')">Продолжить</button>';
            } else {
                foot = '<button class="primary" onclick="Exams.start(\'' + e.id + '\')">Начать экзамен</button>';
            }
            return '<article class="card">'
                + '<div class="row between"><span class="pill">' + esc(e.level || '—') + '</span><span class="muted" style="font-size:12px">' + esc(e.state || '') + '</span></div>'
                + '<h3 style="margin:18px 0 8px">' + esc(e.title) + '</h3>'
                + '<p class="muted">' + esc(e.description || 'Проверьте свои знания.') + '</p>'
                + '<div class="row muted">' + (isAdminMode ? '<span>' + (e.questions || []).length + ' заданий</span> · ' : '') + '<span>' + e.minutes + ' мин</span> · <span>' + maxScore(e) + ' баллов</span></div>'
                + '<div style="font-size:12px;margin-top:12px">Порог ' + e.pass + '% · Попыток: ' + e.limit + '</div>'
                + (isAdminMode ? '<div style="font-size:12px;margin-top:8px" class="muted">' + esc(assignLabel(e)) + '</div>' : '')
                + '<div class="foot row">' + foot + '</div></article>';
        }).join('');
    }

    function assignLabel(e) {
        if (e.state === 'Черновик') return 'Черновик · видит только преподаватель';
        if (e.forAll !== false && !(e.groupIds || []).length) return 'Для всех учеников';
        var names = (e.groupIds || []).map(function (gid) {
            var g = allGroups().find(function (x) { return x && x.id === gid; });
            return g ? g.name : gid;
        });
        if (names.length) return 'Группы: ' + names.join(', ');
        return 'Назначение не задано · доступен всем';
    }

    function assignExam(id) {
        var e = findExam(id);
        if (!e) return;
        db.groups = allGroups();
        var groupsHtml = allGroups().length
            ? allGroups().map(function (g) {
                var checked = (e.groupIds || []).indexOf(g.id) >= 0;
                return '<label style="font-weight:500;margin:6px 0"><input type="checkbox" class="exGroup" value="' + esc(g.id) + '" ' + (checked ? 'checked' : '') + '> ' + esc(g.name) + '</label>';
            }).join('')
            : '<div class="muted">Группы не найдены в журнале. Сначала создайте группу в разделе «Журнал».</div>';
        modal('<span class="tag">НАЗНАЧЕНИЕ</span><h2>' + esc(e.title) + '</h2>'
            + '<label>Статус<select id="asgState">'
            + ['Черновик', 'Опубликован', 'Открыт', 'Закрыт', 'Архив'].map(function (s) {
                return '<option value="' + s + '" ' + (e.state === s ? 'selected' : '') + '>' + s + '</option>';
            }).join('')
            + '</select></label>'
            + '<label style="font-weight:600;margin-top:12px"><input type="checkbox" id="asgForAll" ' + ((e.forAll !== false && !(e.groupIds || []).length) ? 'checked' : '') + '> Для всех учеников</label>'
            + '<div id="asgGroupWrap" style="margin-top:10px;' + ((e.forAll !== false && !(e.groupIds || []).length) ? 'opacity:.45;pointer-events:none' : '') + '">'
            + '<label>Группы (все участники выбранных групп получат доступ)</label>'
            + groupsHtml
            + '</div>'
            + '<div class="note">Черновик видит только преподаватель. Опубликованный экзамен доступен согласно назначению.</div>'
            + '<div class="row" style="margin-top:14px">'
            + '<button class="primary" onclick="Exams.saveAssign(\'' + id + '\')">Сохранить назначение</button>'
            + '<button class="ghost" onclick="Exams.closeModal()">Отмена</button></div>');
        var fa = $('asgForAll');
        if (fa) {
            fa.addEventListener('change', function () {
                var wrap = $('asgGroupWrap');
                if (!wrap) return;
                wrap.style.opacity = fa.checked ? '.45' : '1';
                wrap.style.pointerEvents = fa.checked ? 'none' : '';
            });
        }
    }

    function saveAssign(id) {
        var e = findExam(id);
        if (!e) return;
        var updated = clone(e);
        updated.state = $('asgState') ? $('asgState').value : e.state;
        var forAll = $('asgForAll') ? $('asgForAll').checked : true;
        updated.forAll = forAll;
        updated.groupIds = forAll ? [] : Array.prototype.slice.call(document.querySelectorAll('#asgGroupWrap .exGroup:checked')).map(function (x) { return x.value; });
        if (!updated.groupIds.length) updated.forAll = true;
        if (updated.forAll) updated.access = [];
        // Assignment must not leave the exam invisible as a draft
        if (updated.state === 'Черновик' && (updated.forAll || updated.groupIds.length)) {
            updated.state = 'Опубликован';
        }
        saveExamToServer(updated);
        closeModal();
        toast('Назначение сохраняется…');
    }

    /* ---------- editor ---------- */
    function freshQuestion() {
        return {
            id: uid(),
            text: '',
            options: ['', '', '', ''],
            answer: 'A',
            points: 1,
            explanation: ''
        };
    }

    function editExam(id) {
        db.groups = allGroups();
        if (id) {
            var e = findExam(id);
            if (!e) return;
            draft = clone(e);
            if (!draft.questions) draft.questions = [];
            if (!Array.isArray(draft.groupIds)) draft.groupIds = [];
            if (draft.forAll == null) draft.forAll = !draft.groupIds.length;
            draft.questions.forEach(function (q) {
                if (!Array.isArray(q.options)) q.options = ['', '', '', ''];
                while (q.options.length < 4) q.options.push('');
            });
        } else {
            draft = {
                id: uid(), title: '', description: '', instruction: '',
                subject: 'Китайский язык', level: 'HSK 4', state: 'Опубликован',
                open: '', close: '', minutes: 30, limit: 1, pass: 60,
                reveal: 'after', navigate: true, access: [], groupIds: [], forAll: true, questions: []
            };
        }
        page = 'editor';
        render();
    }

    function editor() {
        var q = draft.questions || [];
        shell('<div class="row between"><div><span class="tag">КОНСТРУКТОР</span><h1 style="margin-top:6px">' + (draft.title ? 'Редактирование' : 'Новый экзамен') + '</h1></div>'
            + '<button class="primary" onclick="Exams.saveExam()">Сохранить экзамен</button></div>'
            + '<div class="panel"><div class="two">'
            + field('exTitle', 'Название', draft.title)
            + sel('exState', 'Статус', STATES.map(function (x) { return [x, x]; }), draft.state)
            + field('exSubject', 'Предмет', draft.subject)
            + field('exLevel', 'Уровень', draft.level)
            + '</div>'
            + area('exDesc', 'Описание', draft.description)
            + area('exInstr', 'Инструкция ученику', draft.instruction)
            + '<div class="two">'
            + field('exOpen', 'Открытие', draft.open, 'datetime-local')
            + field('exClose', 'Закрытие', draft.close, 'datetime-local')
            + field('exMin', 'Время, минут', draft.minutes, 'number', 'min="1" max="600"')
            + field('exLimit', 'Попыток на ученика', draft.limit, 'number', 'min="1"')
            + field('exPass', 'Проходной процент', draft.pass, 'number', 'min="0" max="100"')
            + sel('exReveal', 'Показ правильных ответов', [['after', 'После завершения'], ['closed', 'После закрытия'], ['never', 'Не показывать']], draft.reveal)
            + '</div>'
            + '<label style="margin-top:10px"><input type="checkbox" id="exNav" ' + (draft.navigate ? 'checked' : '') + '> Разрешить возврат к предыдущим вопросам</label>'
            + '</div>'
            + '<div class="panel"><h2>Назначение</h2>'
            + '<p class="muted">Кому будет доступен экзамен после публикации.</p>'
            + '<label style="font-weight:600"><input type="checkbox" id="exForAll" ' + (draft.forAll !== false ? 'checked' : '') + '> Для всех учеников</label>'
            + '<div id="exGroupWrap" style="margin-top:12px;' + (draft.forAll !== false ? 'opacity:.45;pointer-events:none' : '') + '">'
            + '<label>Группы</label>'
            + (allGroups().length
                ? allGroups().map(function (g) {
                    var checked = (draft.groupIds || []).indexOf(g.id) >= 0;
                    return '<label style="font-weight:500;margin:6px 0"><input type="checkbox" class="exGroup" value="' + esc(g.id) + '" ' + (checked ? 'checked' : '') + '> ' + esc(g.name) + '</label>';
                }).join('')
                : '<div class="muted">Группы не найдены в журнале. Сначала создайте группу в разделе «Журнал».</div>')
            + '</div>'
            + '<div class="note">Черновик видит только преподаватель. Опубликованный экзамен показывается согласно назначению.</div>'
            + '</div>'
            + '<div class="panel"><div class="row between"><h2>Вопросы · ' + q.length + ' <small class="muted">/ ' + maxScore(draft) + ' баллов</small></h2>'
            + '<button class="primary" onclick="Exams.questionEditor()">+ Добавить вопрос</button></div>'
            + '<div class="row">'
            + '<button class="primary" onclick="Exams.importTemplate()">📥 Импорт по шаблону (DOCX / текст)</button>'
            + '<button onclick="Exams.previewDraft()">Предпросмотр</button>'
            + '</div>'
            + '<div class="note">Импорт по шаблону: <b>1. вопрос → A. … B. … C. … D. … → «Правильный ответ: B. …»</b>. Файл .docx или вставьте текст.</div>'
            + (q.length ? q.map(function (qq, i) {
                return '<div class="question"><div class="row between"><span class="pill">' + (i + 1) + ' · один ответ</span><span>' + qq.points + ' б.</span></div>'
                    + '<h3 style="margin-top:12px">' + esc(qq.text || '—') + '</h3>'
                    + '<div class="row"><button onclick="Exams.questionEditor(' + i + ')">Изменить</button>'
                    + '<button onclick="Exams.moveQ(' + i + ',-1)">↑</button>'
                    + '<button onclick="Exams.moveQ(' + i + ',1)">↓</button>'
                    + '<button class="danger" onclick="Exams.removeQ(' + i + ')">Удалить</button></div></div>';
            }).join('') : '<div class="empty">Добавьте вопрос или импортируйте по шаблону.</div>')
            + '</div>'
            + '<div class="exam-save-bar" id="examSaveBar"><button class="primary" onclick="Exams.saveExam()">Сохранить экзамен</button>'
            + '<button class="ghost" onclick="Exams.go(\'exams\')">Отмена</button></div>');
        // Floating "scroll to save" button
        try {
            var oldFloat = document.getElementById('examFloatDown');
            if (oldFloat && oldFloat.parentNode) oldFloat.parentNode.removeChild(oldFloat);
            var fbtn = document.createElement('button');
            fbtn.type = 'button';
            fbtn.id = 'examFloatDown';
            fbtn.className = 'exam-float-down';
            fbtn.title = 'К кнопке сохранения';
            fbtn.setAttribute('aria-label', 'Перейти к кнопке сохранения');
            fbtn.innerHTML = '↓';
            fbtn.onclick = function () {
                var bar = document.getElementById('examSaveBar');
                if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'end' });
            };
            document.body.appendChild(fbtn);
        } catch (e) { }
        var fa = $('exForAll');
        if (fa) {
            fa.addEventListener('change', function () {
                var wrap = $('exGroupWrap');
                if (!wrap) return;
                if (fa.checked) {
                    wrap.style.opacity = '.45';
                    wrap.style.pointerEvents = 'none';
                } else {
                    wrap.style.opacity = '1';
                    wrap.style.pointerEvents = '';
                }
            });
        }
    }

    function field(id, label, value, type, extra) {
        return '<label>' + esc(label) + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value) + '" ' + (extra || '') + '></label>';
    }
    function area(id, label, value) {
        return '<label>' + esc(label) + '<textarea id="' + id + '">' + esc(value) + '</textarea></label>';
    }
    function sel(id, label, options, value) {
        return '<label>' + esc(label) + '<select id="' + id + '">' + options.map(function (o) {
            return '<option value="' + esc(o[0]) + '" ' + (o[0] === value ? 'selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></label>';
    }

    function captureExam() {
        if (!$('exTitle')) return;
        draft.title = $('exTitle').value;
        draft.state = $('exState').value;
        draft.subject = $('exSubject').value;
        draft.level = $('exLevel').value;
        draft.description = $('exDesc').value;
        draft.instruction = $('exInstr').value;
        draft.open = $('exOpen').value;
        draft.close = $('exClose').value;
        draft.minutes = Number($('exMin').value) || 1;
        draft.limit = Number($('exLimit').value) || 1;
        draft.pass = Number($('exPass').value);
        if (!Number.isFinite(draft.pass)) draft.pass = 60;
        draft.reveal = $('exReveal').value;
        draft.navigate = $('exNav').checked;
        draft.forAll = $('exForAll') ? $('exForAll').checked : true;
        draft.groupIds = draft.forAll ? [] : Array.prototype.slice.call(document.querySelectorAll('#exGroupWrap .exGroup:checked')).map(function (x) { return x.value; });
        // No groups selected → available to all students
        if (!draft.groupIds.length) draft.forAll = true;
        draft.access = draft.forAll ? [] : (draft.access || []);
    }

    function saveExam() {
        captureExam();
        if (!draft.title.trim()) { toast('Укажите название.'); return; }
        if (!draft.questions.length) { toast('Добавьте хотя бы один вопрос.'); return; }
        for (var i = 0; i < draft.questions.length; i++) {
            var q = draft.questions[i];
            if (!String(q.text || '').trim()) { toast('Вопрос ' + (i + 1) + ': нет текста.'); return; }
            var opts = (q.options || []).map(function (o) { return String(o || '').trim(); }).filter(Boolean);
            if (opts.length < 2) { toast('Вопрос ' + (i + 1) + ': нужно минимум 2 варианта.'); return; }
            if (!String(q.answer || '').trim()) { toast('Вопрос ' + (i + 1) + ': нет правильного ответа.'); return; }
        }
        // A saved exam must be visible to students (all or assigned groups), not stuck as draft
        if (draft.state === 'Черновик' && (draft.forAll !== false || (draft.groupIds || []).length)) {
            draft.state = 'Опубликован';
        }
        saveExamToServer(clone(draft));
        // draft is cleared on server confirm (onExamsSaved)
        toast('Сохраняем на сервере…');
    }

    function moveQ(i, d) {
        captureExam();
        if (i + d < 0 || i + d >= draft.questions.length) return;
        var t = draft.questions[i];
        draft.questions[i] = draft.questions[i + d];
        draft.questions[i + d] = t;
        editor();
    }
    function removeQ(i) {
        captureExam();
        if (!confirm('Удалить этот вопрос?')) return;
        draft.questions.splice(i, 1);
        editor();
    }

    function questionEditor(i) {
        captureExam();
        editingIndex = (i === undefined || i === null) ? null : i;
        editingQ = editingIndex === null ? freshQuestion() : clone(draft.questions[editingIndex]);
        if (!Array.isArray(editingQ.options)) editingQ.options = ['', '', '', ''];
        while (editingQ.options.length < 4) editingQ.options.push('');
        drawQEditor();
    }

    function drawQEditor() {
        var q = editingQ;
        modal('<h2>' + (editingIndex === null ? 'Новый вопрос' : 'Редактирование вопроса') + '</h2>'
            + area('qText', 'Текст вопроса', q.text)
            + '<div class="two">'
            + field('qA', 'Вариант A', q.options[0])
            + field('qB', 'Вариант B', q.options[1])
            + field('qC', 'Вариант C', q.options[2])
            + field('qD', 'Вариант D', q.options[3])
            + '</div>'
            + sel('qAns', 'Правильный ответ', [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'],
            ['text:' + (q.options[0] || ''), 'Текст: ' + (q.options[0] || '—')],
            ['text:' + (q.options[1] || ''), 'Текст: ' + (q.options[1] || '—')],
            ['text:' + (q.options[2] || ''), 'Текст: ' + (q.options[2] || '—')],
            ['text:' + (q.options[3] || ''), 'Текст: ' + (q.options[3] || '—')]], /^text:/.test(q.answer) ? q.answer : (/^[A-D]$/.test(String(q.answer || '').toUpperCase()) ? String(q.answer).toUpperCase() : 'A'))
            + field('qPoints', 'Баллы', q.points, 'number', 'min="0.5" step="0.5"')
            + area('qExp', 'Пояснение к правильному ответу', q.explanation)
            + '<div id="qError"></div>'
            + '<button class="primary" onclick="Exams.saveQuestion()">Сохранить вопрос</button>');
        var ansSel = $('qAns');
        if (ansSel) {
            // refresh letter/text options when letters chosen
            ansSel.onchange = function () { /* value captured on save */ };
        }
    }

    function readQ() {
        var q = editingQ;
        q.text = $('qText').value;
        q.options = [$('qA').value, $('qB').value, $('qC').value, $('qD').value];
        var av = $('qAns').value;
        if (/^text:/.test(av)) {
            q.answer = av.slice(5);
            // map back to letter if possible
            var idx = q.options.indexOf(q.answer);
            if (idx >= 0) q.answer = 'ABCD'.charAt(idx);
        } else {
            q.answer = av;
        }
        q.points = Number($('qPoints').value) || 1;
        q.explanation = $('qExp').value;
    }

    function saveQuestion() {
        readQ();
        var errors = [];
        if (!String(qTextSafe())) errors.push('Нет текста вопроса.');
        var opts = editingQ.options.map(function (o) { return String(o || '').trim(); });
        var filled = opts.filter(Boolean);
        if (filled.length < 2) errors.push('Нужно минимум 2 варианта ответа.');
        if (!String(editingQ.answer || '').trim()) errors.push('Укажите правильный ответ.');
        if (errors.length) {
            $('qError').innerHTML = '<div class="error">' + esc(errors.join('\n')) + '</div>';
            return;
        }
        // store only filled options
        editingQ.options = filled;
        if (editingIndex === null) draft.questions.push(clone(editingQ));
        else draft.questions[editingIndex] = clone(editingQ);
        closeModal();
        editor();
    }
    function qTextSafe() {
        return editingQ && editingQ.text;
    }

    /* ---------- CSV ---------- */
    function download(name, data, type) {
        var blob = new Blob([data], { type: type || 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    function csv(rows) {
        return '\uFEFF' + rows.map(function (r) {
            return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(';');
        }).join('\r\n');
    }
    /* ---------- импорт по шаблону HSK (DOCX / текст) ---------- */
    function importTemplate() {
        captureExam();
        modal('<h2>Импорт по шаблону</h2>'
            + '<p class="detail">Поддерживается формат теста HSK:</p>'
            + '<pre class="note">1. 法律\nA. журналистика\nB. право\nC. характер\nD. причина\nПравильный ответ: B. право</pre>'
            + '<label>Файл .docx или .txt<input type="file" id="tplFile" accept=".docx,.txt,.text"></label>'
            + '<label>Или вставьте текст теста<textarea id="tplText" rows="8" placeholder="1. 法律&#10;A. журналистика&#10;B. право&#10;C. характер&#10;D. причина&#10;Правильный ответ: B. право"></textarea></label>'
            + '<div id="tplStatus"></div>'
            + '<button class="primary" onclick="Exams.runTemplateImport()">Распознать и добавить</button>');
        var f = $('tplFile');
        if (f) {
            f.onchange = function () {
                if (!f.files || !f.files[0]) return;
                var file = f.files[0];
                if (/\.docx$/i.test(file.name)) {
                    var r = new FileReader();
                    r.onload = function () {
                        var b64 = String(r.result || '').split(',')[1] || '';
                        sendTemplateRequest({ base64: b64, filename: file.name });
                    };
                    r.readAsDataURL(file);
                } else {
                    var rt = new FileReader();
                    rt.onload = function () {
                        if ($('tplText')) $('tplText').value = String(rt.result || '');
                        toast('Текст загружен. Нажмите «Распознать и добавить».');
                    };
                    rt.readAsText(file, 'utf-8');
                }
            };
        }
    }

    function runTemplateImport() {
        var text = $('tplText') ? $('tplText').value : '';
        if (!text.trim()) {
            toast('Вставьте текст или выберите файл .docx');
            return;
        }
        sendTemplateRequest({ text: text });
    }

    function sendTemplateRequest(payload) {
        var st = $('tplStatus');
        if (st) st.innerHTML = '<div class="note">Распознаём…</div>';
        fetch('/api/exams/import-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.ok) {
                    var msg = (data && (data.error || (data.errors || []).join('\n'))) || 'Не удалось разобрать.';
                    if (st) st.innerHTML = '<div class="error">' + esc(msg) + '</div>';
                    return;
                }
                applyTemplateQuestions(data);
            })
            .catch(function (e) {
                if (st) st.innerHTML = '<div class="error">Ошибка: ' + esc(e.message) + '</div>';
            });
    }

    function applyTemplateQuestions(data) {
        var qs = (data.questions || []).map(function (q) {
            return {
                id: uid(),
                text: q.text,
                options: (q.options || []).filter(Boolean),
                answer: q.answer,
                points: 1,
                explanation: ''
            };
        });
        if (!qs.length) {
            var st = $('tplStatus');
            if (st) st.innerHTML = '<div class="error">Вопросы не найдены.</div>';
            return;
        }
        captureExam();
        if (!draft.title && data.title) draft.title = data.title;
        draft.questions = (draft.questions || []).concat(qs);
        closeModal();
        editor();
        toast('Добавлено вопросов: ' + qs.length + (data.errors && data.errors.length ? ' (предупреждений: ' + data.errors.length + ')' : '') + '. Сохраните экзамен.');
        setTimeout(function () {
            var bar = document.getElementById('examSaveBar');
            if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 120);
    }

    /* ---------- run exam ---------- */
    function availableForMe(e) {
        if (!e) return false;
        if (e.state !== 'Открыт' && e.state !== 'Опубликован') return false;
        if (e.open && now() < new Date(e.open).getTime()) return false;
        if (e.close && now() > new Date(e.close).getTime()) return false;
        return true;
    }

    function start(id) {
        var e = findExam(id);
        if (!e) return;
        if (!meUser()) { toast('Войдите в аккаунт.'); return; }
        if (!availableForMe(e)) { toast('Экзамен ещё не открыт или уже закрыт.'); return; }
        var done = myAttempts(id);
        if (done.length >= (e.limit || 1)) { toast('Доступные попытки использованы.'); return; }
        modal('<span class="tag">ПЕРЕД НАЧАЛОМ</span><h2>' + esc(e.title) + '</h2>'
            + '<p class="detail">' + esc(e.instruction || 'Прочитайте задания и ответьте на вопросы.') + '</p>'
            + '<div class="note">' + e.minutes + ' минут · порог ' + e.pass + '%'
            + '<br>Таймер продолжает идти после закрытия страницы. ' + (e.navigate ? 'Можно возвращаться к вопросам.' : 'Возврат к предыдущим вопросам запрещён.') + '</div>'
            + '<button class="primary" onclick="Exams.confirmStart(\'' + id + '\')">Подтверждаю, начать</button>');
    }

    function confirmStart(id) {
        var e = findExam(id);
        if (!e) return;
        var attempt = {
            id: uid(),
            examId: e.id,
            examSnapshot: clone(e),
            userId: meUser().id,
            studentName: myName(),
            start: now(),
            deadline: now() + (e.minutes || 20) * 60000,
            answers: {},
            grades: {},
            position: 0,
            end: null,
            status: 'В процессе',
            number: myAttempts(id).length + 1
        };
        db.attempts.push(attempt);
        // register in-progress attempt on server (without final grade)
        saveResultToServer({
            id: attempt.id,
            examId: e.id,
            start: attempt.start,
            deadline: attempt.deadline,
            answers: {},
            status: 'В процессе',
            final: false,
            number: attempt.number,
            studentName: attempt.studentName
        });
        closeModal();
        active = attempt.id;
        qi = 0;
        runView();
    }

    function resume(id) {
        var a = findAttempt(id);
        if (!a) return;
        active = id;
        qi = a.position || 0;
        runView();
    }

    function leaveAttempt() {
        active = null;
        page = 'progress';
        render();
    }

    function runView() {
        var a = findAttempt(active);
        if (!a) { active = null; render(); return; }
        var snap = a.examSnapshot || findExam(a.examId) || {};
        var questions = snap.questions || [];
        if (!questions.length) { active = null; render(); return; }
        qi = Math.min(qi, questions.length - 1);
        var q = questions[qi];
        var answered = questions.filter(function (qq) { return hasAnswer(a.answers[qq.id]); }).length;
        var opts = (q.options || []);
        var val = a.answers[q.id];

        shell('<div class="sticky row between"><div><span class="tag">ЭКЗАМЕН В ПРОЦЕССЕ</span>'
            + '<h2 style="margin:3px 0">' + esc(snap.title || '') + '</h2></div>'
            + '<div><span class="muted">Осталось</span><div class="timer" id="exTimer"></div></div></div>'
            + '<div class="split"><div class="panel">'
            + '<div class="row"><small class="muted">' + q.points + ' баллов</small></div>'
            + '<h2 class="detail" style="margin-top:18px">' + esc(q.text) + '</h2>'
            + opts.map(function (x, j) {
                var letter = 'ABCD'.charAt(j);
                return '<label class="option"><input type="radio" name="exAns" value="' + esc(letter) + '" '
                    + (String(val || '').toUpperCase() === letter || val === x ? 'checked' : '')
                    + ' onchange="Exams.answer(\'' + letter + '\')"><span><b>' + letter + '.</b> ' + esc(x) + '</span></label>';
            }).join('')
            + '<div class="row between" style="margin-top:22px">'
            + (qi > 0 && snap.navigate !== false ? '<button class="ghost" onclick="Exams.goQ(' + (qi - 1) + ')">← Назад</button>' : '<span></span>')
            + (qi < questions.length - 1
                ? '<button class="primary" onclick="Exams.goQ(' + (qi + 1) + ')">Далее →</button>'
                : '<button class="primary" onclick="Exams.submitAttempt()">Завершить экзамен</button>')
            + '</div>'
            + '<div class="row" style="margin-top:12px;gap:12px">'
            + '<button class="ghost" style="flex:1 1 180px;min-height:54px;padding:15px 22px;font-size:16px" title="Продолжить позже" onclick="Exams.leaveAttempt()">Продолжить</button>'
            + '<button class="primary" style="flex:1 1 180px;min-height:54px;padding:15px 22px;font-size:16px" onclick="Exams.submitAttempt()">Завершить</button>'
            + '</div>'
            + '<small class="success" id="exSaved">Ответы сохраняются на сервере</small>'
            + '</div><div>'
            + '<div class="panel"><h3>Твой прогресс</h3>'
            + '<div class="progress"><i id="exProgressBar" style="width:' + (answered / questions.length * 100) + '%"></i></div>'
            + '</div>'
            + '<small class="muted">Таймер не останавливается при выходе. Результаты доступны на всех устройствах.</small>'
            + '</div></div>');
        startTick();
    }

    function answer(letter) {
        var a = findAttempt(active);
        if (!a || a.end) return;
        if (now() >= (a.deadline || 0)) { finish(a, true); return; }
        var snap = a.examSnapshot || {};
        var q = (snap.questions || [])[qi];
        if (!q) return;
        var opts = q.options || [];
        var letterIdx = letter.toUpperCase().charCodeAt(0) - 65;
        var textVal = opts[letterIdx] || letter;
        a.answers[q.id] = letter; // store letter
        a.position = qi;
        saveAnswerToServer(a.id, a.answers, qi, { examId: a.examId, start: a.start, deadline: a.deadline });
        var questions = snap.questions || [];
        var answered = questions.filter(function (qq) { return hasAnswer(a.answers[qq.id]); }).length;
        var sv = $('exSaved');
        if (sv) sv.textContent = '✓ Сохранено · ' + new Date().toLocaleTimeString('ru-RU');
        var pb = $('exProgressBar');
        if (pb) pb.style.width = (answered / questions.length * 100) + '%';
        // авто-переход к следующему вопросу после выбора ответа
        if (qi < questions.length - 1) {
            qi += 1;
            a.position = qi;
            saveAnswerToServer(a.id, a.answers, qi, { examId: a.examId, start: a.start, deadline: a.deadline });
            runView();
        }
    }

    function goQ(i) {
        var a = findAttempt(active);
        if (!a) return;
        var snap = a.examSnapshot || {};
        if (snap.navigate === false && i < qi) return;
        qi = i;
        a.position = i;
        saveAnswerToServer(a.id, a.answers, i, { examId: a.examId, start: a.start, deadline: a.deadline });
        runView();
    }

    function submitAttempt() {
        var a = findAttempt(active);
        if (!a) return;
        if (!confirm('Завершить экзамен? Изменить ответы после отправки нельзя.')) return;
        finish(a, false);
    }

    function finish(a, timeout) {
        if (!a || a.end) return;
        var snap = a.examSnapshot || findExam(a.examId) || {};
        a.end = timeout ? (a.deadline || now()) : now();
        a.durationSec = Math.round((a.end - a.start) / 1000);
        a.answers = a.answers || {};
        a.status = 'Проверяется';
        pendingResultId = a.id;
        // Server grades against the live exam (correct answers never leave the server).
        saveResultToServer({
            id: a.id,
            examId: a.examId || snap.id,
            start: a.start,
            end: a.end,
            deadline: a.deadline,
            answers: a.answers,
            status: 'Завершён',
            final: true,
            number: a.number,
            studentName: a.studentName || myName(),
            userId: a.userId
        });
        if (timeout) toast('Время истекло. Ответы отправлены на проверку.');
        else toast('Ответы отправлены. Проверяем…');
    }

    function startTick() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = setInterval(function () {
            var a = findAttempt(active);
            if (!a || a.end) {
                clearInterval(tickTimer);
                tickTimer = null;
                return;
            }
            var sec = Math.max(0, Math.ceil(((a.deadline || 0) - now()) / 1000));
            var el = $('exTimer');
            if (el) {
                el.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
                el.style.color = sec < 60 ? '#b34438' : '';
            }
            if (sec <= 60 && !warned[a.id]) {
                warned[a.id] = true;
                toast('Осталась одна минута');
            }
            if (sec <= 0) {
                finish(a, true);
            }
        }, 1000);
    }

    /* ---------- results ---------- */
    function results() {
        var arr = db.attempts.filter(function (a) { return a && a.end; });
        if (!isAdminMode) {
            var u = meUser();
            arr = arr.filter(function (a) {
                if (!u) return false;
                if (a.userId && a.userId === u.id) return true;
                if (!a.userId && a.studentName && a.studentName === myName()) return true;
                return false;
            });
        }
        arr = arr.slice().sort(function (x, y) { return (y.end || 0) - (x.end || 0); });
        shell('<div class="row between"><h1>' + (isAdminMode ? 'Результаты' : 'Мои результаты') + '</h1>'
            + (isAdminMode ? '<button onclick="Exams.exportResults()">Экспорт CSV</button>' : '') + '</div>'
            + '<p class="muted">' + (isAdminMode ? 'Все сохранённые попытки. Откройте результат, чтобы проверить ответы.' : 'Твои достижения и ответы на задания.') + '</p>'
            + (arr.length ? arr.map(function (a) {
                var title = (a.examSnapshot && a.examSnapshot.title) || (findExam(a.examId) || {}).title || 'Экзамен';
                return '<div class="panel"><div class="row between"><div>'
                    + '<span class="pill">' + esc(a.status || '') + '</span>'
                    + '<h3 style="margin:10px 0 4px">' + esc(title) + '</h3>'
                    + '<small class="muted">' + esc(a.studentName || '') + ' · попытка ' + (a.number || 1) + ' · ' + fmtDate(a.start) + '</small>'
                    + '</div><div class="row"><div><div class="stat">' + a.percent + '%</div>'
                    + '<small class="muted">' + a.score + ' / ' + a.maxScore + ' баллов</small></div>'
                    + '<button onclick="Exams.showResult(\'' + a.id + '\')">Подробнее</button></div></div></div>';
            }).join('') : '<div class="panel empty">Результатов пока нет.</div>'));
    }

    function showResult(id) {
        var a = findAttempt(id);
        if (!a) { toast('Результат не найден.'); return; }
        var snap = a.examSnapshot || findExam(a.examId) || {};
        var questions = snap.questions || [];
        var reveal = true;
        if (snap.reveal === 'never') reveal = isAdminMode;
        else if (snap.reveal === 'closed') {
            var live = findExam(a.examId);
            reveal = isAdminMode || (live && (live.state === 'Закрыт' || live.state === 'Архив'));
        }
        var gradeVals = Object.keys(a.grades || {}).map(function (k) { return (a.grades || {})[k]; });
        var counts = {};
        gradeVals.forEach(function (g) {
            if (g && g.status) counts[g.status] = (counts[g.status] || 0) + 1;
        });
        modal('<span class="tag">РЕЗУЛЬТАТ · ПОПЫТКА ' + (a.number || 1) + '</span>'
            + '<h2>' + esc(snap.title || 'Экзамен') + '</h2>'
            + '<p>' + esc(a.studentName || myName()) + '</p>'
            + '<div class="hero"><div class="stat">' + a.percent + '% <span style="font-size:16px">' + esc(a.status || '') + '</span></div>'
            + '<p>' + a.score + ' / ' + (a.maxScore || maxScore(snap)) + ' баллов · ' + Math.round((a.durationSec || 0) / 60 * 10) / 10 + ' мин</p>'
            + '<p class="muted">' + Object.keys(counts).map(function (k) { return esc(k) + ': ' + counts[k]; }).join(' · ') + '</p></div>'
            + '<small class="muted">Начало ' + fmtDate(a.start) + '<br>Завершение ' + fmtDate(a.end) + '</small>'
            + questions.map(function (q, i) {
                var g = (a.grades || {})[q.id] || {};
                var ansLetter = String(g.answer || (a.answers || {})[q.id] || '').toUpperCase();
                var opts = q.options || [];
                var ansText = g.answerText || opts[ansLetter.charCodeAt(0) - 65] || ansLetter || 'Не дан';
                var correct = g.correct || '';
                return '<div class="question"><div class="row between">'
                    + '<span class="pill">' + (isAdminMode ? (i + 1) + ' · ' : '') + esc(g.status || '—') + '</span>'
                    + '<b>' + (g.score != null ? g.score : 0) + ' / ' + q.points + '</b></div>'
                    + '<h3 style="margin-top:12px">' + esc(q.text) + '</h3>'
                    + '<p class="detail">Ответ: ' + esc(ansLetter ? (ansLetter + '. ' + ansText) : ansText) + '</p>'
                    + (reveal && correct ? '<p class="detail muted">Эталон: ' + esc(correct) + (q.explanation ? ' · ' + esc(q.explanation) : '') + '</p>' : '')
                    + '</div>';
            }).join(''));
    }

    function exportResults() {
        var rows = [['Ученик', 'Экзамен', 'Дата', 'Попытка', 'Баллы', 'Максимум', 'Процент', 'Статус', 'Секунд']];
        db.attempts.filter(function (a) { return a && a.end; }).forEach(function (a) {
            var title = (a.examSnapshot && a.examSnapshot.title) || (findExam(a.examId) || {}).title || '';
            rows.push([a.studentName || '', title, fmtDate(a.start), a.number || 1, a.score, a.maxScore, a.percent, a.status, a.durationSec || 0]);
        });
        download('Mandarin_Exam_Results.csv', csv(rows), 'text/csv;charset=utf-8');
    }

    /* ---------- stats / help / preview ---------- */
    function stats() {
        var ended = db.attempts.filter(function (a) { return a && a.end; });
        shell('<h1>Статистика</h1><p class="muted">По сохранённым попыткам на сервере.</p>'
            + '<div class="metrics">'
            + '<div>Начали<div class="stat">' + db.attempts.length + '</div></div>'
            + '<div>Завершили<div class="stat">' + ended.length + '</div></div>'
            + '<div>Средний результат<div class="stat">' + (ended.length ? Math.round(ended.reduce(function (s, a) { return s + (a.percent || 0); }, 0) / ended.length) : 0) + '%</div></div>'
            + '<div>Сдали<div class="stat">' + ended.filter(function (a) { return a.status === 'Сдан'; }).length + '</div></div>'
            + '</div>'
            + (db.exams.map(function (e) {
                var all = db.attempts.filter(function (a) { return a && a.examId === e.id && a.end; });
                return '<div class="panel"><h2>' + esc(e.title) + '</h2><p class="muted">Завершили: ' + all.length
                    + ' · Сдали: ' + all.filter(function (a) { return a.status === 'Сдан'; }).length
                    + ' · Среднее: ' + (all.length ? Math.round(all.reduce(function (s, a) { return s + (a.percent || 0); }, 0) / all.length) : 0) + '%</p></div>';
            }).join('') || '<div class="panel empty">Статистика появится после попыток.</div>'));
    }

    function helpPage() {
        shell('<h1>Шаблоны и инструкция</h1>'
            + '<div class="panel"><h2>Импорт по шаблону HSK (.docx / текст)</h2>'
            + '<p>Основной способ — готовый тест в формате шаблона HSK:</p>'
            + '<pre style="white-space:pre-wrap;background:#fff;padding:12px;border-radius:10px">1. 法律\nA. журналистика\nB. право\nC. характер\nD. причина\nПравильный ответ: B. право</pre>'
            + '<ul style="padding-left:18px;line-height:1.7">'
            + '<li>Файл <b>.docx</b> (шаблон HSK4) или вставка текста.</li>'
            + '<li>Строки вида «1. …» — вопрос, «A.–D.» — варианты, «Правильный ответ: …» — эталон.</li>'
            + '<li>Разделы «Часть 1…» и служебные строки пропускаются автоматически.</li>'
            + '</ul>'
            + '<div class="row"><button class="primary" onclick="Exams.importTemplate()">📥 Импорт по шаблону</button></div>'
            + '</div>'
            + '<div class="panel"><h2>Как добавить тест</h2>'
            + '<ol style="padding-left:18px;line-height:1.7">'
            + '<li>Создайте экзамен → «Импорт по шаблону» → выберите .docx или вставьте текст.</li>'
            + '<li>Проверьте вопросы → «Сохранить экзамен».</li>'
            + '<li>Назначьте группы или режим «Для всех учеников» → статус «Опубликован».</li>'
            + '<li>Ученик проходит тест — баллы и «Сдан / Не сдан» считаются автоматически.</li>'
            + '<li>Результаты появляются в разделе «Результаты» и в дневнике ученика.</li>'
            + '</ol></div>');
    }

    function preview(id) {
        var e = findExam(id);
        if (e) previewExam(e);
    }
    function previewDraft() {
        captureExam();
        previewExam(draft);
    }
    function previewExam(e) {
        modal('<h2>' + esc(e.title || 'Предпросмотр') + '</h2><p class="detail">' + esc(e.instruction) + '</p>'
            + (e.questions || []).map(function (q, i) {
                return '<div class="question"><span class="pill">' + (i + 1) + ' · ' + q.points + ' б.</span>'
                    + '<h3>' + esc(q.text) + '</h3>'
                    + (q.options || []).map(function (o, j) {
                        return '<div class="option"><span><b>' + 'ABCD'.charAt(j) + '.</b> ' + esc(o) + '</span></div>';
                    }).join('')
                    + '<p class="detail muted">Ответ: ' + esc(q.answer) + '</p></div>';
            }).join(''));
    }

    function removeExam(id) {
        if (!confirm('Удалить экзамен и его результаты?')) return;
        if (BP && BP.examsDelete) BP.examsDelete(id);
    }

    /* ---------- diary integration ---------- */
    function getMyFinished() {
        var u = meUser();
        if (!u) return [];
        return db.attempts.filter(function (a) {
            return a && a.end && (a.userId === u.id || (!a.userId && a.studentName === myName()));
        }).sort(function (x, y) { return (y.end || 0) - (x.end || 0); });
    }

    function renderDiaryBlock() {
        // returns HTML for journal diary; refresh from server at most every 20s
        if (Date.now() - lastPullAt > 20000) pull();
        var list = getMyFinished();
        var html = '<div class="jr-subtitle" style="margin-top:28px;cursor:pointer;display:flex;align-items:center;gap:8px" onclick="Exams.openDiaryResults()">'
            + 'Результаты экзаменов <span class="jr-mini" style="margin-left:auto">' + list.length + '</span></div>';
        if (!list.length) {
            html += '<div class="jr-empty">Завершённых экзаменов пока нет.</div>';
        } else {
            html += '<div class="jr-mini" style="margin-bottom:8px">Нажмите, чтобы открыть список и подробные результаты.</div>';
            list.slice(0, 3).forEach(function (a) {
                var title = (a.examSnapshot && a.examSnapshot.title) || 'Экзамен';
                html += '<div class="jr-record"><div class="jr-record-head"><div>'
                    + '<b>' + esc(title) + '</b>'
                    + '<div class="jr-mini">' + fmtDate(a.start) + ' · ' + a.percent + '% · ' + esc(a.status) + '</div>'
                    + '</div><div class="jr-right"><span class="jr-score ' + (a.status === 'Сдан' ? 'green' : 'red') + '">' + a.percent + '%</span></div></div></div>';
            });
        }
        return html;
    }

    function openDiaryResults() {
        var list = getMyFinished();
        modal('<h2>Результаты экзаменов</h2>'
            + (list.length ? list.map(function (a) {
                var title = (a.examSnapshot && a.examSnapshot.title) || 'Экзамен';
                return '<div class="panel"><div class="row between"><div>'
                    + '<span class="pill">' + esc(a.status) + '</span>'
                    + '<h3 style="margin:10px 0 4px">' + esc(title) + '</h3>'
                    + '<small class="muted">' + fmtDate(a.start) + ' · ' + (a.durationSec || 0) + ' сек · попытка ' + (a.number || 1) + '</small>'
                    + '<div class="stat" style="margin:10px 0">' + a.percent + '%</div>'
                    + '<small class="muted">' + a.score + ' / ' + a.maxScore + ' баллов</small>'
                    + '</div><button class="primary" onclick="Exams.showResult(\'' + a.id + '\')">Открыть</button></div></div>';
            }).join('') : '<div class="empty">Завершённых экзаменов пока нет.</div>'));
    }

    /* ---------- render ---------- */
    function render() {
        if (!$('examsRoot')) return;
        if (active) { runView(); return; }
        if (page === 'editor' && draft) { editor(); return; }
        if (page === 'results') { results(); return; }
        if (page === 'stats') { stats(); return; }
        if (page === 'help') { helpPage(); return; }
        catalog();
    }

    function go(p) {
        if (draft && p !== 'editor' && !confirm('Выйти из редактора? Несохранённые изменения будут потеряны.')) return;
        draft = null;
        // вкладки должны работать даже во время прохождения экзамена
        if (active) { active = null; qi = 0; }
        page = p;
        filter = '';
        try {
            var fl = document.getElementById('examFloatDown');
            if (fl && fl.parentNode) fl.parentNode.removeChild(fl);
        } catch (e) { }
        render();
    }

    /* ---------- public API ---------- */
    var _inited = false;
    window.Exams = {
        init: function (bridge) {
            if (_inited) { BP = bridge || window.BP || BP; return; }
            _inited = true;
            BP = bridge || window.BP || null;
            ensureStyles();
            if (!db.groups || !db.groups.length) db.groups = fetchGroupsFromJournal();
            pull();
            if (BP && BP.onExamsUpdate) {
                BP.onExamsUpdate(function (data) {
                    applyServerData(data);
                });
            }
            if (BP && BP.onExamsSaved) {
                BP.onExamsSaved(function (data) {
                    if (data && data.ok) {
                        toast('Экзамен сохранён.');
                        draft = null;
                        page = 'exams';
                        pull();
                    } else if (data && data.error) {
                        toast(data.error);
                    }
                });
            }
            if (BP && BP.onExamsResultSaved) {
                BP.onExamsResultSaved(function (data) {
                    onResultSaved(data);
                });
            }
        },
        reload: function () {
            pull();
        },
        onNavigate: function (s) {
            if (s === 'exams') {
                pull();
                render();
            } else {
                try {
                    var fl = document.getElementById('examFloatDown');
                    if (fl && fl.parentNode) fl.parentNode.removeChild(fl);
                } catch (e) { }
            }
        },
        render: render,
        go: go,
        setFilter: function (v) {
            filter = v;
            var exams = isAdminMode ? db.exams : db.exams.filter(function (e) {
                return e && (e.state === 'Открыт' || e.state === 'Опубликован');
            });
            drawCards(exams);
        },
        editExam: editExam,
        assignExam: assignExam,
        saveAssign: saveAssign,
        saveExam: saveExam,
        removeExam: removeExam,
        preview: preview,
        previewDraft: previewDraft,
        questionEditor: questionEditor,
        saveQuestion: saveQuestion,
        moveQ: moveQ,
        removeQ: removeQ,
        importTemplate: importTemplate,
        runTemplateImport: runTemplateImport,
        exportResults: exportResults,
        start: start,
        confirmStart: confirmStart,
        resume: resume,
        leaveAttempt: leaveAttempt,
        answer: answer,
        goQ: goQ,
        submitAttempt: submitAttempt,
        showResult: showResult,
        closeModal: closeModal,
        getMyFinished: getMyFinished,
        renderDiaryBlock: renderDiaryBlock,
        openDiaryResults: openDiaryResults,
        getData: function () { return db; }
    };

    if (window.BP) window.Exams.init(window.BP);
    document.addEventListener('DOMContentLoaded', function () {
        if (window.BP) window.Exams.init(window.BP);
    });
})();
