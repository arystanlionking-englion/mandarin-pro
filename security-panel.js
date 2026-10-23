/* MANDARIN PRO — скрытая панель мониторинга (Ctrl+Shift+9 / NumPad9)
 * Отдельная от админ-панели. Показывает ВСЕ действия и изменения в программе.
 * Read-only: без удаления/редактирования журнала.
 */
(function () {
    'use strict';

    var panel = null;
    var openFlag = false;
    var lastFetch = 0;
    var state = {
        tab: 'all',
        q: '',
        page: 1,
        pageSize: 25,
        userFilter: '',
        from: '',
        to: '',
        items: [],
        total: 0
    };

    function isAdminNow() {
        try {
            if (window.BP && BP.isAdmin && BP.isAdmin()) return true;
        } catch (e) { }
        try {
            if (typeof isAdmin !== 'undefined' && isAdmin) return true;
        } catch (e) { }
        return false;
    }

    function adminToken() {
        try { return localStorage.getItem('pb_admin_token') || ''; } catch (e) { return ''; }
    }

    function esc(s) {
        try { if (window.esc) return window.esc(s); } catch (e) { }
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function fmtTs(ts) {
        if (!ts) return '—';
        try {
            return new Date(ts).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        } catch (e) { return String(ts); }
    }

    function roleLabel(role) {
        var map = { admin: 'Админ', student: 'Ученик', system: 'Система', user: 'Ученик' };
        return esc(map[role] || role || '—');
    }

    function ensurePanel() {
        if (panel && document.body.contains(panel)) return panel;
        panel = document.createElement('div');
        panel.id = 'secPanelRoot';
        panel.setAttribute('data-sec-panel', '1');
        panel.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483000',
            'background:rgba(10,8,14,.82)', 'display:none',
            'padding:16px', 'overflow:auto'
        ].join(';');
        panel.innerHTML = ''
            + '<div style="max-width:1120px;margin:0 auto;background:#17141f;border:1px solid #c9a84c55;border-radius:18px;padding:18px;'
            + 'box-shadow:0 24px 70px #000a;font-family:Inter,Segoe UI,sans-serif;color:#f3e8cf">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">'
            + '<div>'
            + '<div style="font-size:11px;letter-spacing:.32em;color:#c9a84c">SECURITY · MONITOR</div>'
            + '<div style="font-size:22px;font-weight:800;color:#f7e4b2;margin-top:4px">Панель безопасности</div>'
            + '<div style="font-size:11px;color:#9a8d7a;margin-top:2px">Все действия и изменения программы · не админ-панель · Ctrl+Shift+9</div>'
            + '</div>'
            + '<button type="button" class="btn btn-ghost btn-sm" id="secClose">✕ Закрыть</button>'
            + '</div>'
            + '<div id="secTabs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'
            + '<button type="button" class="coupon-subtab on" data-tab="all">Все события</button>'
            + '<button type="button" class="coupon-subtab" data-tab="admin">Действия администратора</button>'
            + '<button type="button" class="coupon-subtab" data-tab="student">Действия учеников</button>'
            + '<button type="button" class="coupon-subtab" data-tab="security">Безопасность</button>'
            + '<button type="button" class="coupon-subtab" data-tab="changes">Изменения данных</button>'
            + '</div>'
            + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">'
            + '<input class="inp" id="secQ" placeholder="Поиск: действие, пользователь, объект..." '
            + 'style="flex:1;min-width:200px;background:#121018;color:#f3e8cf;border-color:#c9a84c44">'
            + '<input type="date" class="inp" id="secFrom" title="С даты" style="background:#121018;color:#f3e8cf;border-color:#c9a84c44">'
            + '<input type="date" class="inp" id="secTo" title="По дату" style="background:#121018;color:#f3e8cf;border-color:#c9a84c44">'
            + '<input class="inp" id="secUser" placeholder="ID / имя пользователя" style="width:170px;background:#121018;color:#f3e8cf;border-color:#c9a84c44">'
            + '<button type="button" class="btn btn-accent btn-sm" id="secApply">Найти</button>'
            + '<button type="button" class="btn btn-ghost btn-sm" id="secReset">Сброс</button>'
            + '</div>'
            + '<div id="secMeta" style="font-size:11px;color:#9a8d7a;margin-bottom:8px"></div>'
            + '<div id="secTable" style="max-height:54vh;overflow:auto;border:1px solid #c9a84c2e;border-radius:12px;background:#121018"></div>'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:8px;flex-wrap:wrap">'
            + '<div id="secPageInfo" style="font-size:12px;color:#9a8d7a"></div>'
            + '<div style="display:flex;gap:8px">'
            + '<button type="button" class="btn btn-ghost btn-sm" id="secPrev">← Назад</button>'
            + '<button type="button" class="btn btn-ghost btn-sm" id="secNext">Вперёд →</button>'
            + '</div></div>'
            + '<div style="margin-top:12px;padding:10px;border:1px solid #c9a84c22;border-radius:10px;background:#121018;color:#9a8d7a;font-size:11px;line-height:1.55">'
            + 'ℹ️ Эта панель <b>отдельная</b> от админ-панели и не открывает её. '
            + 'Журнал append-only на сервере (hash-chain), API удаления нет. '
            + 'При доступе к файлам локального сервера записи можно изменить — это не абсолютная неизменяемость. '
            + 'Пароли и токены не записываются.</div>'
            + '</div>';

        document.body.appendChild(panel);

        panel.addEventListener('click', function (e) {
            if (e.target === panel) { hide(); return; }
            var t = e.target && e.target.closest ? e.target.closest('button,[data-row]') : null;
            if (!t) return;
            if (t.id === 'secClose') { hide(); return; }
            if (t.id === 'secApply') {
                state.q = val('secQ');
                state.from = val('secFrom');
                state.to = val('secTo');
                state.userFilter = val('secUser');
                state.page = 1;
                load();
                return;
            }
            if (t.id === 'secReset') {
                state.q = state.from = state.to = state.userFilter = '';
                state.page = 1;
                ['secQ', 'secFrom', 'secTo', 'secUser'].forEach(function (id) {
                    var el = panel.querySelector('#' + id);
                    if (el) el.value = '';
                });
                load();
                return;
            }
            if (t.id === 'secPrev') { if (state.page > 1) { state.page--; load(); } return; }
            if (t.id === 'secNext') {
                var maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
                if (state.page < maxPage) { state.page++; load(); }
                return;
            }
            if (t.dataset && t.dataset.tab) {
                state.tab = t.dataset.tab;
                state.page = 1;
                panel.querySelectorAll('#secTabs .coupon-subtab').forEach(function (b) {
                    b.classList.toggle('on', b.dataset.tab === state.tab);
                });
                load();
                return;
            }
            if (t.dataset && t.dataset.row) showDetail(t.dataset.row);
        });

        panel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); hide(); }
            if (e.key === 'Enter' && e.target && e.target.id === 'secQ') {
                state.q = val('secQ');
                state.page = 1;
                load();
            }
        });

        return panel;
    }

    function val(id) {
        var el = panel.querySelector('#' + id);
        return el ? String(el.value || '').trim() : '';
    }

    function show() {
        if (!isAdminNow() || !adminToken()) {
            try { alert('Доступ запрещён. Нужна авторизация администратора.'); } catch (e) { }
            return;
        }
        ensurePanel();
        panel.style.display = 'block';
        openFlag = true;
        load();
    }

    function hide() {
        openFlag = false;
        if (panel) panel.style.display = 'none';
    }

    function load() {
        if (!panel) return;
        if (Date.now() - lastFetch < 200) return;
        lastFetch = Date.now();
        var box = panel.querySelector('#secTable');
        if (box) box.innerHTML = '<div style="padding:18px;color:#9a8d7a">Загрузка событий…</div>';
        var payload = {
            adminToken: adminToken(),
            tab: state.tab,
            q: state.q,
            page: state.page,
            pageSize: state.pageSize,
            userFilter: state.userFilter,
            allSources: true
        };
        if (state.from) payload.from = new Date(state.from + 'T00:00:00').getTime();
        if (state.to) payload.to = new Date(state.to + 'T23:59:59').getTime();
        try {
            if (window.socket && socket.emit) socket.emit('audit:query', payload);
        } catch (e) {
            if (box) box.innerHTML = '<div style="padding:18px;color:#e36b80">Нет соединения с сервером</div>';
        }
    }

    function renderResult(d) {
        if (!panel || !openFlag) return;
        if (!d || !d.ok) {
            var err = panel.querySelector('#secTable');
            if (err) err.innerHTML = '<div style="padding:18px;color:#e36b80">' + esc((d && d.error) || 'Нет данных') + '</div>';
            return;
        }
        state.items = d.items || [];
        state.total = d.total || 0;
        var meta = panel.querySelector('#secMeta');
        if (meta) {
            meta.textContent = 'Показано записей: ' + state.items.length + ' из ' + state.total +
                ' · источники: журнал действий, безопасность, админ-история, изменения · append-only';
        }
        var maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
        var info = panel.querySelector('#secPageInfo');
        if (info) info.textContent = 'Страница ' + state.page + ' / ' + maxPage;

        var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">'
            + '<thead><tr style="color:#9a8d7a;text-align:left;border-bottom:1px solid #c9a84c22">'
            + '<th style="padding:10px 8px">Время</th>'
            + '<th style="padding:10px 8px">Пользователь</th>'
            + '<th style="padding:10px 8px">Роль</th>'
            + '<th style="padding:10px 8px">Действие / изменение</th>'
            + '<th style="padding:10px 8px">Объект</th>'
            + '<th style="padding:10px 8px">Итог</th>'
            + '<th style="padding:10px 8px"></th>'
            + '</tr></thead><tbody>';

        if (!state.items.length) {
            html += '<tr><td colspan="7" style="padding:20px;color:#9a8d7a">Нет записей</td></tr>';
        } else {
            state.items.forEach(function (r) {
                var okColor = r.result === 'error' ? '#e36b80' : '#22c55e';
                var change = '';
                if (r.oldValue != null || r.newValue != null) {
                    change = '<div style="color:#9a8d7a;font-size:10px;margin-top:3px">' +
                        esc(String(r.oldValue == null ? '—' : r.oldValue)) +
                        ' → ' + esc(String(r.newValue == null ? '—' : r.newValue)) + '</div>';
                }
                html += '<tr style="border-top:1px solid #c9a84c12">'
                    + '<td style="padding:10px 8px;white-space:nowrap">' + esc(fmtTs(r.ts)) + '</td>'
                    + '<td style="padding:10px 8px">' + esc(r.actorName || r.actorId || '—')
                    + (r.actorId ? '<div style="color:#6f6578;font-size:10px">' + esc(String(r.actorId).slice(0, 12)) + '</div>' : '')
                    + '</td>'
                    + '<td style="padding:10px 8px">' + roleLabel(r.actorRole) + '</td>'
                    + '<td style="padding:10px 8px">' + esc(r.action || '—') + change + '</td>'
                    + '<td style="padding:10px 8px">' + esc(r.target || '—') + '</td>'
                    + '<td style="padding:10px 8px;color:' + okColor + '">' + esc(r.result || '') + '</td>'
                    + '<td style="padding:10px 8px"><button type="button" class="btn btn-ghost btn-sm" data-row="' + esc(r.id) + '">Подробнее</button></td>'
                    + '</tr>';
            });
        }
        html += '</tbody></table>';
        var box = panel.querySelector('#secTable');
        if (box) box.innerHTML = html;
    }

    function showDetail(id) {
        var r = null;
        for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].id === id) { r = state.items[i]; break; }
        }
        if (!r) return;
        var lines = [
            'Время: ' + fmtTs(r.ts),
            'ID записи: ' + (r.id || ''),
            'Пользователь: ' + (r.actorName || '—'),
            'ID пользователя: ' + (r.actorId || '—'),
            'Роль: ' + (r.actorRole || '—'),
            'Действие: ' + (r.action || ''),
            'Затронутый объект: ' + (r.target || '—'),
            'Старое значение: ' + (r.oldValue == null ? '—' : r.oldValue),
            'Новое значение: ' + (r.newValue == null ? '—' : r.newValue),
            'Результат: ' + (r.result || ''),
            'Источник: ' + (r.source || '—'),
            'Причина отказа: ' + (r.reason || '—'),
            'Хеш: ' + (r.hash || '—'),
            'Предыдущий хеш: ' + (r.prevHash || '—')
        ];
        alert(lines.join('\n'));
    }

    // Hotkey: Ctrl/Command + Shift + Digit9 / NumPad9 only (NOT e.key — Shift+9 is '(').
    function onHotkey(e) {
        if (!e.ctrlKey && !e.metaKey) return;
        if (!e.shiftKey) return;
        var code = e.code || '';
        if (code !== 'Digit9' && code !== 'Numpad9') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        if (openFlag) hide();
        else show();
    }

    // Capture on window — earlier than page handlers
    window.addEventListener('keydown', onHotkey, true);

    if (window.socket && socket.on) {
        socket.on('audit:result', function (d) { renderResult(d); });
    }

    window.SecPanel = {
        open: show,
        close: hide,
        reload: load,
        isOpen: function () { return openFlag; }
    };
})();
