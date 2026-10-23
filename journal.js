/* Bank Mandarin Pro — модуль журнала и дневника
 * Источник логики: дневник.html (mandarin-pro-journal-v3)
 * Расчёты оценок и баллов сохранены без изменений.
 */
(function () {
    'use strict';

    var KEY = 'mandarin-pro-journal-v3';
    var BACKUP_PREFIX = 'mandarin-pro-journal-v3-backup-';

    var TODAY = function () {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };

    var emptyDb = function () {
        return { groups: [], students: [], records: [], settings: { reward: 300 } };
    };

    /* ---------- утилиты (из исходного журнала) ---------- */
    function uid() {
        return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    }

    function grade(p) {
        var table = [
            [95, 'A', 4, 'Отлично', 'green'],
            [90, 'A−', 3.67, 'Отлично', 'green'],
            [85, 'B+', 3.33, 'Хорошо', 'green'],
            [80, 'B', 3, 'Хорошо', 'green'],
            [75, 'B−', 2.67, 'Хорошо', 'green'],
            [70, 'C+', 2.33, 'Хорошо', 'green'],
            [65, 'C', 2, 'Удовлетворительно', 'yellow'],
            [60, 'C−', 1.67, 'Удовлетворительно', 'yellow'],
            [55, 'D+', 1.33, 'Удовлетворительно', 'yellow'],
            [50, 'D', 1, 'Удовлетворительно', 'yellow'],
            [25, 'FX', 0.5, 'Неудовлетворительно', 'red'],
            [0, 'F', 0, 'Неудовлетворительно', 'red']
        ];
        for (var i = 0; i < table.length; i++) {
            if (p >= table[i][0]) {
                return { letter: table[i][1], gpa: table[i][2], traditional: table[i][3], color: table[i][4] };
            }
        }
    }

    function valid(v) {
        return v !== '' && v !== null && v !== undefined && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
    }

    function points(p) {
        return Math.round(db.settings.reward * p / 100);
    }

    function shortDate(d) {
        return new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    }

    function recordsOf(id) {
        return db.records.filter(function (r) { return r.studentId === id; })
            .sort(function (a, b) {
                return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
            });
    }

    /* ---------- мост к Bank Mandarin Pro ---------- */
    var BP = null;
    function esc(s) {
        if (BP && BP.esc) return BP.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(type, title, body) {
        if (BP && BP.toast) BP.toast(type, title, body);
    }
    function openAppModal(id) {
        if (BP && BP.openModal) BP.openModal(id);
    }
    function closeAppModal(id) {
        if (BP && BP.closeModal) BP.closeModal(id);
    }
    function refreshIcons() {
        if (BP && BP.refreshIcons) BP.refreshIcons();
    }
    function isAdminNow() {
        return !!(BP && BP.isAdmin && BP.isAdmin());
    }
    function currentUser() {
        return (BP && BP.getUser && BP.getUser()) || null;
    }
    function appUsers() {
        return (BP && BP.getUsers && BP.getUsers()) || [];
    }
    function appGroups() {
        return (BP && BP.getGroups && BP.getGroups()) || [];
    }

    /* ---------- хранилище + миграция с резервной копией ---------- */
    var db = emptyDb();

    function backupDb() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return;
            var stamp = Date.now();
            localStorage.setItem(BACKUP_PREFIX + stamp, raw);
            // оставляем только 3 свежих копии
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(BACKUP_PREFIX) === 0) keys.push(k);
            }
            keys.sort();
            while (keys.length > 3) {
                localStorage.removeItem(keys.shift());
            }
        } catch (e) { /* игнорируем сбой бэкапа */ }
    }

    function migrate(raw) {
        var changed = false;
        if (raw.students) {
            raw.students.forEach(function (s) {
                if (!s.id) { s.id = uid(); changed = true; }
                if (!s.userId) {
                    // попытка связать с аккаунтом Bank Mandarin Pro по имени
                    var u = appUsers().find(function (x) { return x.name === s.name; });
                    if (u) { s.userId = u.id; changed = true; }
                }
            });
        }
        if (raw.records) {
            raw.records.forEach(function (r) {
                if (!r.id) { r.id = uid(); changed = true; }
                if (r.createdAt === undefined) { r.createdAt = new Date().toISOString(); changed = true; }
            });
        }
        if (!raw.settings) { raw.settings = { reward: 300 }; changed = true; }
        else if (raw.settings.reward === undefined) { raw.settings.reward = 300; changed = true; }
        return { data: raw, changed: changed };
    }

    function load() {
        try {
            var raw = JSON.parse(localStorage.getItem(KEY));
            if (raw && Array.isArray(raw.groups) && Array.isArray(raw.students) && Array.isArray(raw.records)) {
                var merged = {
                    groups: raw.groups,
                    students: raw.students,
                    records: raw.records,
                    settings: Object.assign({ reward: 300 }, raw.settings || {})
                };
                var m = migrate(merged);
                if (m.changed) {
                    backupDb();
                    try { localStorage.setItem(KEY, JSON.stringify(m.data)); } catch (e) { }
                }
                return m.data;
            }
        } catch (e) { /* повреждённые данные */ }
        return emptyDb();
    }

    function cacheLocal(data) {
        try {
            backupDb();
            localStorage.setItem(KEY, JSON.stringify(data));
        } catch (e) { /* кэш не критичен */ }
    }

    function bpUserIdFor(s) {
        if (!s) return null;
        if (s.userId) return s.userId;
        var u = appUsers().find(function (x) { return x.name === s.name; });
        return u ? u.id : null;
    }

    function save(extraLinks) {
        if (!isAdminNow()) {
            toast('e', 'Журнал', 'Сохранение оценок доступно только администратору');
            return false;
        }
        cacheLocal(db);
        if (BP && BP.journalSave) {
            var links = extraLinks || db.students.map(function (s) {
                var uid = bpUserIdFor(s);
                return uid ? { studentId: s.id, userId: uid } : null;
            }).filter(Boolean);
            BP.journalSave({
                groups: db.groups,
                students: db.students,
                records: db.records,
                settings: db.settings,
                links: links
            });
            return true;
        }
        return true;
    }

    db = load();

    function applyServerData(data) {
        if (!data || typeof data !== 'object') return;
        var next = emptyDb();
        if (Array.isArray(data.groups)) next.groups = data.groups;
        if (Array.isArray(data.students)) next.students = data.students;
        if (Array.isArray(data.records)) next.records = data.records;
        if (data.settings && typeof data.settings === 'object') {
            next.settings = Object.assign({ reward: 300 }, data.settings);
        }
        var serverEmpty = !next.groups.length && !next.students.length && !next.records.length;
        var localHas = db.groups.length || db.students.length || db.records.length;
        // Миграция: на сервере пусто, а в localStorage есть данные — публикуем их (только админ).
        if (serverEmpty && localHas && isAdminNow()) {
            try {
                if (BP && BP.journalSave) {
                    BP.journalSave({
                        groups: db.groups,
                        students: db.students,
                        records: db.records,
                        settings: db.settings
                    });
                    return;
                }
            } catch (e) { }
        }
        db = next;
        // localStorage — кэш миграции и полного среза администратора.
        // Ученик не перезаписывает его отфильтрованным срезом.
        if (isAdminNow()) cacheLocal(db);
    }

    function pullFromServer() {
        if (BP && BP.journalGet) BP.journalGet();
    }

    /* ---------- состояние UI ---------- */
    var groupId = '';
    var date = TODAY();
    var selectedDate = TODAY();
    var draft = {};
    var message = '';
    var diaryDate = TODAY();

    /* ---------- связь учеников с аккаунтами ---------- */
    function findStudentForUser(u) {
        if (!u) return null;
        var byUid = db.students.find(function (s) { return s.userId === u.id || s.id === u.id; });
        if (byUid) return byUid;
        return db.students.find(function (s) { return s.name === u.name; }) || null;
    }

    function subjectName() {
        return 'Китайский язык';
    }

    function findRecord(studentId, day) {
        var subj = subjectName();
        return db.records.find(function (r) {
            return r.studentId === studentId && r.date === day && r.subject === subj;
        }) || null;
    }

    function isLinkedToAccount(s) {
        if (!s) return false;
        if (s.userId) return true;
        return appUsers().some(function (u) { return u.name === s.name; });
    }

    /* ============================================================
       ДНЕВНИК УЧЕНИКА
       ============================================================ */
    function renderDiary() {
        var root = document.getElementById('diaryRoot');
        if (!root) return;
        var u = currentUser();
        if (!u) {
            root.innerHTML = '<div class="empty">Войдите в аккаунт, чтобы открыть дневник.</div>';
            return;
        }
        var s = findStudentForUser(u);
        if (!s) {
            root.innerHTML =
                '<div class="jr-panel"><div class="jr-empty">Оценок пока нет.<br><span class="jr-muted">Преподаватель добавит вас в группу и выставит оценки — они появятся здесь автоматически.</span></div></div>';
            return;
        }
        var all = recordsOf(s.id);
        var dayRecords = all.filter(function (r) { return r.date === diaryDate; });
        var html = '';
        html += '<div class="jr-panel">';
        html += '<div class="jr-head"><div><div class="jr-title">' + esc(s.name) + '</div>';
        var g = db.groups.find(function (x) { return x.id === s.groupId; });
        html += '<div class="jr-muted">' + esc(g ? g.name : 'Без группы') + ' · Мой дневник</div></div></div>';

        html += '<div class="jr-head" style="margin-top:22px"><div class="jr-subtitle">' +
            (diaryDate === TODAY() ? 'Сегодня' : 'Занятия') + ' · ' + esc(shortDate(diaryDate)) + '</div>';
        html += '<div class="jr-fields">' +
            '<button type="button" class="btn btn-ghost btn-sm" id="diaryPrev">←</button>' +
            '<input type="date" class="inp jr-date" id="diaryPick" value="' + esc(diaryDate) + '">' +
            '<button type="button" class="btn btn-ghost btn-sm" id="diaryNext">→</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="diaryToday">Сегодня</button>' +
            '</div></div>';

        if (dayRecords.length) {
            dayRecords.forEach(function (r) {
                var color = r.color === 'green' ? '#22c55e' : r.color === 'yellow' ? '#eab308' : '#ef4444';
                html += '<div class="jr-hero"><div>' +
                    '<div class="jr-muted">' + esc(r.subject) + ' · ' + esc(shortDate(r.date)) + '</div>' +
                    '<div class="jr-grade" style="color:' + color + '">' + esc(r.letter) + '</div>' +
                    '<div class="jr-percent">' + r.percent + '% <span class="jr-score ' + esc(r.color) + '">' + esc(r.traditional) + '</span></div>' +
                    '</div><div class="jr-right">' +
                    '<div class="jr-muted">Начислено за занятие</div>' +
                    '<div class="jr-money">+' + r.points + ' ◈</div>' +
                    '<div class="jr-mini">Основные: ' + r.basePoints + ' · Дополнительно: ' + r.bonus + '</div>' +
                    (r.note ? '<div class="jr-mini" style="margin-top:8px;max-width:260px">' + esc(r.note) + '</div>' : '') +
                    '</div></div>';
            });
        } else {
            html += '<div class="jr-empty">На выбранную дату оценок пока нет.</div>';
        }

        html += '<div class="jr-subtitle" style="margin-top:28px">История занятий</div>';
        if (all.length) {
            all.forEach(function (r) {
                html += '<div class="jr-record"><div class="jr-record-head"><div>' +
                    '<b>' + esc(shortDate(r.date)) + ' · ' + esc(r.subject) + '</b>' +
                    '<div class="jr-mini">' + r.percent + '% · ' + esc(r.traditional) + '</div>' +
                    (r.note ? '<div class="jr-mini">' + esc(r.note) + '</div>' : '') +
                    '</div><div class="jr-right">' +
                    '<span class="jr-score ' + esc(r.color) + '">' + esc(r.letter) + '</span>' +
                    '<div style="font-weight:800;margin-top:5px">+' + r.points + ' ◈</div>' +
                    '</div></div></div>';
            });
        } else {
            html += '<div class="jr-empty">История пока пуста.</div>';
        }
        html += '</div>';

        root.innerHTML = html;

        function move(n) {
            var d = new Date(diaryDate + 'T12:00:00');
            d.setDate(d.getDate() + n);
            diaryDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            renderDiary();
        }
        var prev = document.getElementById('diaryPrev');
        var next = document.getElementById('diaryNext');
        var todayBtn = document.getElementById('diaryToday');
        var pick = document.getElementById('diaryPick');
        if (prev) prev.onclick = function () { move(-1); };
        if (next) next.onclick = function () { move(1); };
        if (todayBtn) todayBtn.onclick = function () { diaryDate = TODAY(); renderDiary(); };
        if (pick) pick.onchange = function (e) {
            if (e.target.value) { diaryDate = e.target.value; renderDiary(); }
        };
        refreshIcons();
    }

    /* ============================================================
       ЖУРНАЛ АДМИНИСТРАТОРА
       ============================================================ */
    function canOpenJournal() {
        return isAdminNow();
    }

    function renderJournal() {
        var root = document.getElementById('journalRoot');
        if (!root) return;
        if (!canOpenJournal()) {
            root.innerHTML = '<div class="jr-empty">Недостаточно прав для открытия журнала.</div>';
            return;
        }
        var group = db.groups.find(function (g) { return g.id === groupId; });
        var members = db.students.filter(function (s) { return s.groupId === groupId; });

        if (!group) {
            var html = '<div class="jr-panel"><div class="jr-head"><div>' +
                '<div class="jr-title">Группы</div>' +
                '<div class="jr-muted">Выберите группу, чтобы открыть журнал учеников</div>' +
                '</div><button type="button" class="btn btn-accent" id="jrAddGroup">＋ Создать группу</button></div>';
            html += '<div class="jr-group-cards">';
            if (db.groups.length) {
                db.groups.forEach(function (g) {
                    var count = db.students.filter(function (s) { return s.groupId === g.id; }).length;
                    html += '<button type="button" class="jr-group-card" data-group="' + esc(g.id) + '">' +
                        '<span><strong>' + esc(g.name) + '</strong>' +
                        '<small style="display:block;margin-top:7px">' + count + ' учеников</small></span>' +
                        '<span>→</span></button>';
                });
            } else {
                html += '<div class="jr-empty">Групп пока нет. Создайте первую группу.</div>';
            }
            html += '</div></div>';
            root.innerHTML = html;

            var addBtn = document.getElementById('jrAddGroup');
            if (addBtn) addBtn.onclick = function () { openJournalModal('group'); };
            root.querySelectorAll('[data-group]').forEach(function (b) {
                b.onclick = function () {
                    groupId = b.dataset.group;
                    draft = {};
                    message = '';
                    renderJournal();
                };
            });
            refreshIcons();
            return;
        }

        var html2 = '<div class="jr-panel">';
        html2 += '<div class="jr-head"><div>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="jrBack">← Все группы</button>' +
            '<div class="jr-title" style="margin-top:14px">' + esc(group.name) + '</div>' +
            '<div class="jr-muted">' + members.length + ' учеников · Китайский язык</div>' +
            '</div><div class="jr-fields">' +
            '<button type="button" class="btn btn-ghost btn-sm" id="jrRename">Переименовать</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="jrMembers">＋ Ученики</button>' +
            '<input type="date" class="inp jr-date" id="jrDate" value="' + esc(date) + '" aria-label="Дата занятия">' +
            '</div></div>';

        if (message) {
            html2 += '<div class="jr-notice">' + esc(message) + '</div>';
        }

        if (members.length) {
            html2 += '<div class="jr-table-wrap"><table class="jr-roster"><thead><tr>' +
                '<th>Ученик</th><th>Оценка, %</th><th>Результат</th><th>Бонус</th>' +
                '</tr></thead><tbody>';
            members.forEach(function (s, i) {
                var d = draft[s.id] || {};
                var existing = findRecord(s.id, date);
                var linked = isLinkedToAccount(s);
                var nameHtml = (i + 1) + '. ' + esc(s.name);
                if (!linked) {
                    nameHtml += ' <span class="jr-mini" style="color:#eab308">(не привязан к аккаунту)</span>';
                }

                if (existing) {
                    // Уже внесено — повторный ввод закрыт
                    var color = existing.color === 'green' ? '#22c55e' : existing.color === 'yellow' ? '#eab308' : '#ef4444';
                    html2 += '<tr class="jr-done-row"><td><div class="jr-name">' + nameHtml + '</div></td>' +
                        '<td><div class="jr-done-badge">✓ ' + existing.percent + '%</div></td>' +
                        '<td><span class="jr-score ' + esc(existing.color) + '">' + esc(existing.letter) + ' · ' + existing.points + ' ◈</span>' +
                        '<div class="jr-mini">Уже внесено · ' + esc(existing.traditional) + '</div></td>' +
                        '<td><div class="jr-mini">' + (existing.bonus ? '+' + existing.bonus + ' бонус' : '') + '</div></td></tr>';
                    return;
                }

                var v = d.percent != null ? d.percent : '';
                var g = valid(v) ? grade(Number(v)) : null;
                html2 += '<tr><td><div class="jr-name">' + nameHtml + '</div></td>' +
                    '<td><input class="inp jr-percent-input" data-id="' + esc(s.id) + '" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="0–100" value="' + esc(v) + '"></td>' +
                    '<td><span class="jr-score-preview">' +
                    (g ? '<span class="jr-score ' + g.color + '">' + g.letter + ' · ' + points(Number(v)) + ' ◈</span>' : '<span class="jr-muted">—</span>') +
                    '</span></td>' +
                    '<td><button type="button" class="jr-arrow" data-extra="' + esc(s.id) + '" title="Дополнительные баллы">' +
                    (d.expanded ? '⌄' : '›') + ' ＋</button></td></tr>' +
                    '<tr><td colspan="4" style="padding:0;border:0"><div class="jr-extra' + (d.expanded ? ' show' : '') + '" id="jr-extra-' + esc(s.id) + '">' +
                    '<input class="inp" type="number" min="0" step="1" data-bonus="' + esc(s.id) + '" placeholder="Бонус ◈" value="' + esc(d.bonus != null ? d.bonus : '') + '">' +
                    '<input class="inp" type="text" maxlength="250" data-note="' + esc(s.id) + '" placeholder="Причина: дополнительное эссе" value="' + esc(d.note != null ? d.note : '') + '">' +
                    '</div></td></tr>';
            });
            html2 += '</tbody></table></div>';
            html2 += '<div class="jr-foot"><div class="jr-muted">↓ — следующий ученик · Enter в последнем поле — сохранить</div>' +
                '<button type="button" class="btn btn-accent" id="jrSubmit">Внести оценки →</button></div>';
        } else {
            html2 += '<div class="jr-empty">В этой группе ещё нет учеников. Нажмите «＋ Ученики».</div>';
        }
        html2 += '</div>';
        root.innerHTML = html2;

        var back = document.getElementById('jrBack');
        if (back) back.onclick = function () { groupId = ''; draft = {}; message = ''; renderJournal(); };
        var rename = document.getElementById('jrRename');
        if (rename) rename.onclick = function () { openJournalModal('rename'); };
        var membersBtn = document.getElementById('jrMembers');
        if (membersBtn) membersBtn.onclick = function () { openJournalModal('students'); };
        var dateEl = document.getElementById('jrDate');
        if (dateEl) dateEl.onchange = function (e) {
            date = e.target.value;
            message = '';
            renderJournal();
        };

        var inputs = root.querySelectorAll('.jr-percent-input');
        inputs.forEach(function (el, i, all) {
            el.oninput = function () {
                var id = el.dataset.id;
                if (!draft[id]) draft[id] = {};
                draft[id].percent = el.value;
                var preview = el.closest('tr').querySelector('.jr-score-preview');
                var g = valid(el.value) ? grade(Number(el.value)) : null;
                preview.innerHTML = g
                    ? '<span class="jr-score ' + g.color + '">' + g.letter + ' · ' + points(Number(el.value)) + ' ◈</span>'
                    : '<span class="jr-muted">—</span>';
            };
            el.onkeydown = function (e) {
                if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    e.preventDefault();
                    if (all[i + 1]) {
                        all[i + 1].focus();
                        all[i + 1].select();
                    } else if (e.key === 'Enter') {
                        submitGrades();
                    }
                }
            };
        });
        root.querySelectorAll('[data-extra]').forEach(function (b) {
            b.onclick = function () {
                var id = b.dataset.extra;
                if (!draft[id]) draft[id] = {};
                draft[id].expanded = !draft[id].expanded;
                var div = document.getElementById('jr-extra-' + id);
                if (div) div.classList.toggle('show', !!draft[id].expanded);
                b.textContent = (draft[id].expanded ? '⌄' : '›') + ' ＋';
            };
        });
        root.querySelectorAll('[data-bonus]').forEach(function (el) {
            el.oninput = function () {
                if (!draft[el.dataset.bonus]) draft[el.dataset.bonus] = {};
                draft[el.dataset.bonus].bonus = el.value;
            };
        });
        root.querySelectorAll('[data-note]').forEach(function (el) {
            el.oninput = function () {
                if (!draft[el.dataset.note]) draft[el.dataset.note] = {};
                draft[el.dataset.note].note = el.value;
            };
        });
        var submitBtn = document.getElementById('jrSubmit');
        if (submitBtn) submitBtn.onclick = submitGrades;
        refreshIcons();
    }

    function submitGrades() {
        if (!canOpenJournal()) {
            toast('e', 'Журнал', 'Недостаточно прав');
            return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            alert('Выберите дату занятия');
            return;
        }
        var subject = subjectName();

        // Уже внесённые оценки — повторно вводить нельзя
        var already = Object.keys(draft).filter(function (id) {
            return findRecord(id, date);
        });
        if (already.length) {
            var lines = already.map(function (id) {
                var r = findRecord(id, date);
                var s = db.students.find(function (x) { return x.id === id; });
                return '• ' + (s ? s.name : id) + ': ' + r.percent + '% · ' + r.letter + ' · +' + r.points + ' ◈';
            });
            alert('Уже внесено — повторно вводить нельзя:\n' + lines.join('\n') + '\n\nВнесите оценки только новым ученикам.');
            return;
        }

        var entries = Object.keys(draft).filter(function (id) {
            var d = draft[id];
            return db.students.some(function (s) { return s.id === id && s.groupId === groupId; }) &&
                d.percent !== undefined && d.percent !== '';
        }).map(function (id) { return [id, draft[id]]; });

        if (!entries.length) {
            alert('Введите хотя бы одну оценку');
            return;
        }
        for (var i = 0; i < entries.length; i++) {
            var d = entries[i][1];
            if (!valid(d.percent)) {
                alert('Процент должен быть целым числом от 0 до 100');
                return;
            }
            if (d.bonus !== undefined && d.bonus !== '' && (!Number.isSafeInteger(Number(d.bonus)) || Number(d.bonus) < 0)) {
                alert('Дополнительный бонус должен быть неотрицательным целым числом');
                return;
            }
            if (Number(d.bonus || 0) > 0 && !String(d.note || '').trim()) {
                alert('Укажите причину дополнительного бонуса');
                return;
            }
        }

        var before = JSON.stringify(db.records);
        var summary = [];
        var creditJobs = [];
        entries.forEach(function (pair) {
            var id = pair[0];
            var d = pair[1];
            var p = Number(d.percent);
            var g = grade(p);
            var bonus = Number(d.bonus || 0);
            var record = {
                id: uid(),
                studentId: id,
                groupId: groupId,
                date: date,
                subject: subject,
                percent: p,
                letter: g.letter,
                gpa: g.gpa,
                traditional: g.traditional,
                color: g.color,
                basePoints: points(p),
                bonus: bonus,
                points: points(p) + bonus,
                note: String(d.note || '').trim(),
                createdAt: new Date().toISOString()
            };
            db.records.push(record);
            var s = db.students.find(function (x) { return x.id === id; });
            var uid2 = bpUserIdFor(s);
            summary.push({
                name: s ? s.name : id,
                linked: !!uid2,
                points: record.points,
                userId: uid2
            });
            if (uid2 && record.points) {
                creditJobs.push({
                    userId: uid2,
                    amount: record.points,
                    key: id + '|' + date + '|' + subject,
                    reason: 'Оценка за занятие ' + record.percent + '%' +
                        (record.subject ? ' · ' + record.subject : '') + ' · ' + record.date
                });
            }
        });
        if (!save()) {
            db.records = JSON.parse(before);
            return;
        }
        // Явное зачисление денег на счёт каждого ученика
        if (BP && BP.journalCredit) {
            creditJobs.forEach(function (job) { BP.journalCredit(job); });
        }

        draft = {};
        var total = 0;
        var linked = 0;
        var unlinked = 0;
        summary.forEach(function (x) {
            total += x.points;
            if (x.linked) linked++; else unlinked++;
        });
        message = 'Сохранено оценок: ' + summary.length + '. Начисление ' + total + ' ◈' +
            (linked ? ' на счета учеников (' + linked + ' уч.)' : '') +
            (unlinked ? '. Внимание: ' + unlinked + ' уч. не привязаны к аккаунту — деньги не зачислены!' : '') + '.';
        if (unlinked) toast('w', 'Журнал', unlinked + ' уч. не привязаны к аккаунту — деньги не зачислены');
        else toast('s', 'Журнал', 'Начислено ' + total + ' ◈ на ' + linked + ' счёт(а)');
        renderJournal();
    }

    /* ============================================================
       МОДАЛЬНЫЕ ОКНА ЖУРНАЛА
       ============================================================ */
    var journalModal = '';

    function openJournalModal(name) {
        if (!canOpenJournal()) return;
        journalModal = name;
        renderJournalModal();
    }

    function closeJournalModal() {
        if (journalModal) {
            closeAppModal('mJournal');
            journalModal = '';
        }
    }

    function renderJournalModal() {
        var m = document.getElementById('journalModalBody');
        if (!m) return;
        if (journalModal === 'group') {
            m.innerHTML = '<h2>Новая группа</h2>' +
                '<label class="jr-label">Название группы</label>' +
                '<input class="inp" id="jrGroupName" maxlength="80" placeholder="Например: Китайский · HSK 2">' +
                '<div class="jr-modal-foot"><button type="button" class="btn btn-ghost" id="jrMCancel">Отмена</button>' +
                '<button type="button" class="btn btn-accent" id="jrMCreate">Добавить группу</button></div>';
            document.getElementById('jrMCreate').onclick = function () {
                var name = document.getElementById('jrGroupName').value.trim();
                if (!name) { alert('Введите название группы'); return; }
                var id = uid();
                db.groups.push({ id: id, name: name });
                if (!save()) { db.groups.pop(); return; }
                groupId = id;
                draft = {};
                closeJournalModal();
                renderJournal();
            };
        } else if (journalModal === 'settings') {
            m.innerHTML = '<h2>Настройки журнала</h2>' +
                '<p class="jr-muted">Стандартная награда за занятие</p>' +
                '<label class="jr-label">Игровые баллы за 100%</label>' +
                '<input class="inp" type="number" id="jrReward" min="0" max="1000000" step="1" value="' + db.settings.reward + '">' +
                '<p class="jr-mini">Изменение действует на новые и обновлённые записи. Ранее сохранённые баллы не пересчитываются.</p>' +
                '<div class="jr-modal-foot"><button type="button" class="btn btn-ghost" id="jrMCancel">Отмена</button>' +
                '<button type="button" class="btn btn-accent" id="jrMCreate">Сохранить</button></div>';
            document.getElementById('jrMCreate').onclick = function () {
                var n = Number(document.getElementById('jrReward').value);
                if (!Number.isSafeInteger(n) || n < 0 || n > 1000000) {
                    alert('Введите целое число от 0 до 1 000 000');
                    return;
                }
                var old = db.settings.reward;
                db.settings.reward = n;
                if (!save()) { db.settings.reward = old; return; }
                closeJournalModal();
            };
        } else if (journalModal === 'rename') {
            var g = db.groups.find(function (x) { return x.id === groupId; });
            if (!g) { closeJournalModal(); return; }
            m.innerHTML = '<h2>Название группы</h2>' +
                '<input class="inp" id="jrGroupName" maxlength="80" value="' + esc(g.name) + '">' +
                '<div class="jr-modal-foot"><button type="button" class="btn btn-ghost" id="jrMCancel">Отмена</button>' +
                '<button type="button" class="btn btn-accent" id="jrMCreate">Сохранить</button></div>';
            document.getElementById('jrMCreate').onclick = function () {
                var name = document.getElementById('jrGroupName').value.trim();
                if (!name) { alert('Введите название'); return; }
                var oldName = g.name;
                g.name = name;
                if (!save()) { g.name = oldName; return; }
                closeJournalModal();
                renderJournal();
            };
        } else if (journalModal === 'students') {
            m.innerHTML = '<h2>Пользователи Bank Mandarin Pro</h2>' +
                '<p class="jr-muted">Добавляйте реальных учеников из аккаунтов приложения и распределяйте по группам.</p>' +
                '<label class="jr-label">Поиск пользователя</label>' +
                '<input class="inp" id="jrSearchUser" placeholder="Имя или фамилия">' +
                '<div class="jr-user-actions" style="margin:10px 0">' +
                '<button type="button" class="btn btn-ghost btn-sm" id="jrAddManual">＋ Добавить вручную</button>' +
                '</div>' +
                '<div id="jrUserList" class="jr-user-list"></div>' +
                '<div class="jr-modal-foot"><button type="button" class="btn btn-accent" id="jrMCancel">Готово</button></div>';

            var draw = function () {
                var q = (document.getElementById('jrSearchUser').value || '').toLowerCase().trim();
                var listEl = document.getElementById('jrUserList');
                var rows = [];

                // сначала — привязанные / добавленные ученики журнала
                db.students
                    .filter(function (s) { return !q || s.name.toLowerCase().includes(q); })
                    .forEach(function (s) {
                        rows.push(
                            '<div class="jr-record"><div class="jr-record-head">' +
                            '<span class="jr-name">' + esc(s.name) +
                            (s.userId ? '' : ' <span class="jr-mini">(вручную)</span>') + '</span>' +
                            '<select class="inp jr-sel" data-move="' + esc(s.id) + '">' +
                            '<option value="">Без группы</option>' +
                            db.groups.map(function (g) {
                                return '<option value="' + esc(g.id) + '"' + (g.id === s.groupId ? ' selected' : '') + '>' + esc(g.name) + '</option>';
                            }).join('') +
                            '</select></div></div>'
                        );
                    });

                // аккаунты приложения, которых ещё нет в журнале
                appUsers()
                    .filter(function (u) { return !q || (u.name || '').toLowerCase().includes(q); })
                    .forEach(function (u) {
                        if (db.students.some(function (s) { return s.userId === u.id || s.name === u.name; })) return;
                        rows.push(
                            '<div class="jr-record"><div class="jr-record-head">' +
                            '<span class="jr-name">' + esc(u.name) + '</span>' +
                            '<button type="button" class="btn btn-accent btn-sm" data-add-user="' + esc(u.id) + '">Добавить</button>' +
                            '</div></div>'
                        );
                    });

                listEl.innerHTML = rows.join('') || '<div class="jr-empty">Пользователи не найдены</div>';

                listEl.querySelectorAll('[data-move]').forEach(function (el) {
                    el.onchange = function () {
                        var st = db.students.find(function (x) { return x.id === el.dataset.move; });
                        if (!st) return;
                        var old = st.groupId;
                        st.groupId = el.value || null;
                        if (!save()) st.groupId = old;
                    };
                });
                listEl.querySelectorAll('[data-add-user]').forEach(function (btn) {
                    btn.onclick = function () {
                        var u = appUsers().find(function (x) { return x.id === btn.dataset.addUser; });
                        if (!u) return;
                        if (db.students.some(function (s) { return s.userId === u.id || s.name === u.name; })) {
                            toast('w', 'Журнал', 'Этот пользователь уже добавлен');
                            return;
                        }
                        db.students.push({ id: uid(), name: u.name, groupId: groupId || null, userId: u.id });
                        if (!save()) { db.students.pop(); return; }
                        draw();
                    };
                });
            };
            document.getElementById('jrSearchUser').oninput = draw;
            document.getElementById('jrAddManual').onclick = function () {
                var name = prompt('Имя ученика');
                if (!name || !name.trim()) return;
                name = name.trim();
                if (db.students.some(function (s) { return s.name === name; })) {
                    toast('w', 'Журнал', 'Ученик с таким именем уже есть');
                    return;
                }
                // Автопривязка к аккаунту Bank Mandarin Pro по имени
                var match = appUsers().find(function (x) { return x.name === name; }) || null;
                db.students.push({ id: uid(), name: name, groupId: groupId || null, userId: match ? match.id : null });
                if (!save()) { db.students.pop(); return; }
                if (match) toast('s', 'Журнал', 'Ученик привязан к аккаунту: ' + name);
                else toast('w', 'Журнал', 'Ученик добавлен без привязки. Баллы начислятся только после привязки к аккаунту.');
                draw();
            };
            draw();
        }

        var cancel = document.getElementById('jrMCancel');
        if (cancel) cancel.onclick = closeJournalModal;
        openAppModal('mJournal');
        refreshIcons();
    }

    /* ============================================================
       ГОРЯЧАЯ КЛАВИША Shift + Plus
       ============================================================ */
    function isTypingTarget(t) {
        if (!t) return false;
        var tag = (t.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (t.isContentEditable) return true;
        return false;
    }

    function isMobileDevice() {
        if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return true;
        if (navigator.maxTouchPoints > 1 && window.innerWidth < 900) return true;
        return false;
    }

    function isPlusCombo(e) {
        if (!e || e.repeat) return false;
        if (e.code === 'NumpadAdd' || e.key === 'Add') return true;
        if (!e.shiftKey) return false;
        if (e.key === '+' || e.key === '=') return true;
        if (e.code === 'Equal' || e.code === 'NumpadAdd') return true;
        return false;
    }

    document.addEventListener('keydown', function (e) {
        if (!isPlusCombo(e)) return;
        if (isTypingTarget(e.target)) return;
        if (isMobileDevice()) return;
        if (document.querySelector && document.querySelector('.modal-bg.on')) {
            // не мешаем работе открытых модалок, кроме как с явным фокусом вне полей
            if (isTypingTarget(document.activeElement)) return;
        }
        if (!isAdminNow()) return;
        e.preventDefault();
        if (window.go) window.go('journal');
    });

    /* ============================================================
       ПУБЛИЧНОЕ API
       ============================================================ */
    window.Journal = {
        init: function (bridge) {
            BP = bridge || null;
            db = load();
            if (BP && BP.onJournalUpdate) {
                BP.onJournalUpdate(function (data) {
                    applyServerData(data);
                    try {
                        renderDiary();
                        renderJournal();
                    } catch (e) { }
                });
            }
            if (BP && BP.onJournalCredit) {
                BP.onJournalCredit(function (res) {
                    try {
                        if (!res) return;
                        if (res.ok && res.skipped) return;
                        if (res.ok) {
                            toast('s', 'Журнал', 'Зачислено ' + (res.points || 0) + ' ◈ → ' + (res.name || '') + ' (счёт: ' + (res.balance != null ? res.balance : '?') + ')');
                        } else if (res.error) {
                            toast('e', 'Журнал', 'Не зачислено: ' + res.error);
                        }
                    } catch (e) { }
                });
            }
            if (BP && BP.onJournalSaved) {
                BP.onJournalSaved(function (res) {
                    try {
                        if (res && res.awarded && res.awarded.length) {
                            // сервер уже начислил — балансы обновлены
                        }
                    } catch (e) { }
                });
            }
            pullFromServer();
        },
        reload: function () {
            db = load();
            pullFromServer();
        },
        renderDiary: renderDiary,
        renderJournal: renderJournal,
        canOpenJournal: canOpenJournal,
        openSettings: function () {
            openJournalModal('settings');
        },
        openJournal: function () {
            if (!canOpenJournal()) {
                toast('w', 'Журнал', 'Раздел доступен только администратору');
                return;
            }
            if (window.go) window.go('journal');
        },
        closeJournalModal: closeJournalModal,
        onNavigate: function (s) {
            pullFromServer();
            if (s === 'diary') renderDiary();
            if (s === 'journal') renderJournal();
        }
    };

    if (window.BP) window.Journal.init(window.BP);
    document.addEventListener('DOMContentLoaded', function () {
        if (window.BP) window.Journal.init(window.BP);
    });
})();
