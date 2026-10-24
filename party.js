/* Bank Mandarin Pro — Крокодил / Бункер
 * Аккаунты и права — из BANK MANDARIN PRO. Карточки только владельцу.
 */
(function () {
    'use strict';

    var BP = null;
    var mode = 'croc'; // active game tab
    var states = { croc: null, bunker: null };
    var myCards = { croc: null, bunker: null };
    var cardOpen = { croc: false, bunker: false };
    var editorMode = 'croc';
    var editorCards = [];
    var page = 'home'; // home | lobby | game | player | editor
    var activeMode = 'croc';

    var TITLES = { croc: 'Крокодил', bunker: 'Бункер' };
    var ICONS = { croc: '🎭', bunker: '🚀' };

    var STYLES = ''
        + '.party-game{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#f5f2ec}'
        + '.party-game *{box-sizing:border-box}'
        + '.pg-hero{text-align:center;padding:18px 8px 8px}'
        + '.pg-hero .eyebrow{font-size:11px;letter-spacing:.28em;color:#e7c687;text-transform:uppercase}'
        + '.pg-hero h1{font:700 clamp(28px,7vw,44px)/1.1 Georgia,serif;margin:10px 0;color:#f3d89c}'
        + '.pg-hero p{color:#a1a5aa;font-size:14px;line-height:1.5;margin:8px 0 0}'
        + '.pg-modes{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}'
        + '@media(max-width:560px){.pg-modes{grid-template-columns:1fr}}'
        + '.pg-mode{border:1px solid #ffffff18;background:#ffffff08;border-radius:18px;padding:18px;cursor:pointer;text-align:left;color:inherit;font:inherit;min-height:180px;display:flex;flex-direction:column;gap:8px}'
        + '.pg-mode:hover,.pg-mode:focus-visible{border-color:#e7c687}'
        + '.pg-mode .num{font-size:11px;letter-spacing:.18em;color:#e7c687}'
        + '.pg-mode h2{margin:0;font:700 24px Georgia,serif;color:#f3d89c}'
        + '.pg-mode p{margin:0;color:#a1a5aa;font-size:13px;line-height:1.45}'
        + '.pg-mode .bottom{margin-top:auto;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#c2c4c5}'
        + '.pg-panel{border:1px solid #ffffff18;background:#ffffff08;border-radius:18px;padding:18px;margin:12px 0}'
        + '.pg-panel h2{margin:0 0 12px;font:600 20px Georgia,serif;color:#f3d89c}'
        + '.pg-muted{color:#a1a5aa;font-size:13px;line-height:1.5}'
        + '.pg-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}'
        + '.pg-btn{border:1px solid #d2aa71;background:#ffffff07;color:#f3dfbc;min-height:48px;padding:12px 16px;border-radius:13px;font-weight:700;cursor:pointer;font:inherit;width:100%;margin-top:10px;touch-action:manipulation}'
        + '.pg-btn.primary{background:linear-gradient(120deg,#f2d89d,#c18b45);color:#211318;border:0}'
        + '.pg-btn.danger{border-color:#a94b5a;color:#ffc3c8}'
        + '.pg-btn.small{width:auto;min-height:40px;padding:8px 12px;margin:0;font-size:13px}'
        + '.pg-btn:disabled{opacity:.38;cursor:default}'
        + '.pg-person{display:flex;gap:10px;align-items:center;padding:11px 0;border-bottom:1px solid #ffffff14}'
        + '.pg-person:last-child{border:0}'
        + '.pg-avatar{width:40px;height:40px;border-radius:50%;background:#e7c687;color:#211318;display:grid;place-items:center;font-weight:800;flex-shrink:0}'
        + '.pg-person .id{flex:1;min-width:0}'
        + '.pg-person strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
        + '.pg-person small{color:#a1a5aa}'
        + '.pg-tag{padding:4px 8px;border-radius:8px;background:#ffffff12;color:#ead0aa;font-size:11px;flex-shrink:0}'
        + '.pg-tag.on{background:rgba(34,197,94,.18);color:#22c55e}'
        + '.pg-tag.off{background:rgba(239,68,68,.15);color:#ef4444}'
        + '.pg-chip{padding:10px 13px;background:#ffffff08;color:#e9d6bc;border:1px solid #b28b604a;border-radius:12px;cursor:pointer;font:inherit}'
        + '.pg-chip.active{background:#d3a760;color:#201319;border-color:#d3a760;font-weight:800}'
        + '.pg-card-scene{perspective:1100px;margin:16px auto;width:min(82vw,320px);height:min(52dvh,420px);min-height:300px}'
        + '.pg-card{width:100%;height:100%;position:relative;transform-style:preserve-3d;transition:transform .32s cubic-bezier(.2,.8,.3,1);cursor:pointer;will-change:transform;-webkit-tap-highlight-color:transparent;border:0;background:transparent;padding:0}'
        + '.pg-card.open{transform:rotateY(180deg)}'
        + '.pg-face{position:absolute;inset:0;border-radius:23px;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;border:2px solid #cda15f;box-shadow:0 18px 48px #0009;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:22px;text-align:center}'
        + '.pg-face.back{background:radial-gradient(circle at 50% 40%,#75243e,#280e1d 72%)}'
        + '.party-game.bunker-theme .pg-face.back{background:radial-gradient(circle at 50% 40%,#213330,#0e1516 72%)}'
        + '.pg-seal{border:2px solid #e0b97d;border-radius:50%;width:110px;height:110px;display:grid;place-items:center;font:56px Georgia,serif;color:#efd6a4}'
        + '.pg-face.front{transform:rotateY(180deg);background:linear-gradient(#241622,#120e18);border-color:#e7c687}'
        + '.party-game.bunker-theme .pg-face.front{background:linear-gradient(#152220,#0c1212);border-color:#8fc7bf}'
        + '.pg-face.front b{font:700 clamp(20px,5.5vw,28px)/1.2 Georgia,serif;color:#f7ebdc;word-break:break-word}'
        + '.pg-hint{font-size:13px;color:#c2c4c5;text-align:center;margin:10px 0}'
        + '.pg-code{display:inline-flex;flex-direction:column;align-items:center;padding:12px 18px;border:1px dashed #e7c687;border-radius:14px;margin:10px 0}'
        + '.pg-code .lbl{font-size:10px;letter-spacing:.16em;color:#a1a5aa;text-transform:uppercase}'
        + '.pg-code strong{font-size:28px;letter-spacing:.12em;color:#f3d89c;font-family:Georgia,serif}'
        + '.pg-editor-list{max-height:420px;overflow-y:auto;margin-top:12px;-webkit-overflow-scrolling:touch}'
        + '.pg-entry{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #ffffff12;font-size:13px}'
        + '.pg-entry span{flex:1;min-width:0;word-break:break-word}'
        + '.pg-banner{position:sticky;top:0;z-index:5;background:rgba(201,168,76,.12);border:1px solid #e7c68755;border-radius:12px;padding:10px 12px;margin:8px 0;font-size:12px;color:#f3d89c;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between}'
        + 'input.pg-inp,select.pg-inp{width:100%;background:#101214;color:#fff;border:1px solid #ffffff28;padding:12px 14px;border-radius:13px;outline:none;min-width:0;font:inherit}'
        + 'input.pg-inp:focus,select.pg-inp:focus{border-color:#e7c687}'
        + '.pg-label{display:block;color:#c2c4c5;font-size:12px;margin:14px 0 6px}'
        + '.pg-check{display:flex;gap:10px;align-items:center;margin:12px 0;font-size:13px;color:#e9d6bc}'
        + '.pg-check input{width:20px;height:20px;accent-color:#d7b773;flex:none}'
        + '@media(max-width:640px){.pg-btn{min-height:52px}.pg-card-scene{width:min(88vw,320px)}}';

    function esc(s) {
        if (BP && BP.esc) return BP.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(type, title, body) {
        if (BP && BP.toast) BP.toast(type, title, body);
    }
    function isAdminNow() {
        if (BP && BP.isAdmin) { try { return !!BP.isAdmin(); } catch (e) {} }
        return false;
    }
    function meUser() {
        return (BP && BP.getUser) ? BP.getUser() : null;
    }
    function emit(ev, data) {
        var payload = data || {};
        if (payload.mode == null) payload.mode = activeMode;
        if (BP && BP.partyEmit) BP.partyEmit(ev, payload);
        else if (BP && BP.mafiaEmit) BP.mafiaEmit(ev, payload);
    }

    function ensureStyles() {
        if (document.getElementById('partyGameStyles')) return;
        var st = document.createElement('style');
        st.id = 'partyGameStyles';
        st.textContent = STYLES;
        document.head.appendChild(st);
    }

    function rootEl() {
        var el = document.getElementById('partyRoot');
        if (!el) {
            el = document.createElement('div');
            el.id = 'partyRoot';
            el.className = 'party-game';
        }
        return el;
    }

    function st() { return states[activeMode] || states[mode] || null; }

    function applyState(d) {
        if (!d || !d.mode) return;
        states[d.mode] = d;
        if (page !== 'editor') {
            activeMode = d.mode;
            // Infer page from state when not on home/editor
            if (page === 'home' || page === 'lobby' || page === 'game' || page === 'player') {
                if (d.status === 'lobby' && d.lobbyOpen) {
                    if (isAdminNow() || d.me && d.me.inRoom) page = 'lobby';
                } else if (d.status === 'playing') {
                    if (isAdminNow()) page = 'game';
                    else if (d.me && d.me.inRoom) page = 'player';
                } else if (d.status === 'finished' && isAdminNow()) {
                    page = 'game';
                }
            }
        }
        render();
    }

    function applyMyCard(d) {
        if (!d || !d.mode) return;
        myCards[d.mode] = d;
        render();
    }

    function flipCard() {
        if (page !== 'player') return;
        var s = st();
        if (!s || s.status !== 'playing') return;
        var m = myCards[activeMode];
        if (!m || !m.card) return;
        cardOpen[activeMode] = !cardOpen[activeMode];
        render();
    }

    function htmlHome() {
        var c = states.croc, b = states.bunker;
        var cN = c && c.deckCount ? c.deckCount : 130;
        var bN = b && b.deckCount ? b.deckCount : 135;
        return ''
            + '<div class="pg-hero"><div class="eyebrow">Два мира. Одна компания.</div>'
            + '<h1>Время быть<br>кем-то другим.</h1>'
            + '<p>Выберите игру. Ученики входят со своих аккаунтов.<br>Карточки видит только их владелец.</p></div>'
            + '<div class="pg-modes">'
            + '<button type="button" class="pg-mode" data-act="choose" data-mode="croc"><span class="num">01 / ПОКАЖИ БЕЗ СЛОВ</span><h2>🎭 Крокодил</h2><p>Знакомые герои. Неожиданные образы. Сможете показать, не произнеся ни слова?</p><div class="bottom"><span>' + cN + ' персонажей</span><span>↗</span></div></button>'
            + '<button type="button" class="pg-mode" data-act="choose" data-mode="bunker"><span class="num">02 / ПРЕДСТАВЬ СВОЕГО ГЕРОЯ</span><h2>🚀 Бункер</h2><p>У каждого — своя роль. Откройте персонажа и расскажите о себе.</p><div class="bottom"><span>' + bN + ' персонажей</span><span>↗</span></div></button>'
            + '</div>'
            + '<div class="pg-panel"><div class="pg-row">'
            + '<button type="button" class="pg-btn primary" data-act="goCroc" style="margin:0;flex:1">🎭 Крокодил</button>'
            + '<button type="button" class="pg-btn" data-act="goBunker" style="margin:0;flex:1">🚀 Бункер</button>'
            + '</div><button type="button" class="pg-btn" data-act="editor">📚 Колоды персонажей</button>'
            + '<p class="pg-muted" style="margin-top:12px">Общие аккаунты Bank Mandarin Pro. Без отдельного ПИН и ввода имени.</p></div>';
    }

    function htmlTabs() {
        return '<div class="pg-row" style="margin:8px 0 4px">'
            + '<button type="button" class="pg-chip' + (activeMode === 'croc' ? ' active' : '') + '" data-act="tab" data-mode="croc">🎭 Крокодил</button>'
            + '<button type="button" class="pg-chip' + (activeMode === 'bunker' ? ' active' : '') + '" data-act="tab" data-mode="bunker">🚀 Бункер</button>'
            + '<button type="button" class="pg-chip" data-act="home">← Главная</button>'
            + '</div>';
    }

    function htmlLobby(s) {
        var adm = isAdminNow();
        var html = htmlTabs();
        html += '<div class="pg-panel"><h2>' + ICONS[activeMode] + ' ' + TITLES[activeMode] + ' · зал ожидания</h2>';
        html += '<div class="pg-code"><span class="lbl">Статус</span><strong>' + (s.lobbyOpen ? 'ОТКРЫТ' : 'ЗАКРЫТ') + '</strong></div>';
        html += '<p class="pg-muted">Участники: <b>' + s.players.length + '</b> · в колоде: <b>' + s.poolCount + '</b></p>';
        if (adm) {
            html += '<div class="pg-label">Раздача карточек</div><div class="pg-row">'
                + '<button type="button" class="pg-chip' + (s.config.distribution === 'all' ? ' active' : '') + '" data-act="cfgDist" data-val="all">Всем сразу</button>'
                + '<button type="button" class="pg-chip' + (s.config.distribution === 'turn' ? ' active' : '') + '" data-act="cfgDist" data-val="turn">По очереди</button>'
                + '</div>';
            html += '<label class="pg-check"><input type="checkbox" data-act="cfgNext"' + (s.config.allowNext ? ' checked' : '') + '><span>Разрешить смену персонажа</span></label>';
        } else {
            html += '<p class="pg-muted">Смена персонажа: <b>' + (s.config.allowNext ? 'разрешена' : 'запрещена') + '</b></p>';
        }
        html += '<h2 style="margin-top:18px">Участники</h2>';
        if (!s.players.length) html += '<p class="pg-muted">Пока никто не вошёл.</p>';
        s.players.forEach(function (p) {
            html += '<div class="pg-person"><div class="pg-avatar">' + esc((p.name || '?').charAt(0).toUpperCase()) + '</div>'
                + '<div class="id"><strong>' + esc(p.name) + '</strong><small>' + (p.online ? 'в сети' : 'офлайн') + '</small></div>'
                + (adm ? '<button type="button" class="pg-btn small danger" data-act="kick" data-uid="' + esc(p.userId) + '">Убрать</button>' : '')
                + '</div>';
        });
        html += '<div style="margin-top:16px">';
        if (!s.me.inRoom) {
            html += '<button type="button" class="pg-btn primary" data-act="join">Присоединиться</button>';
        } else {
            html += '<button type="button" class="pg-btn" data-act="leave">Выйти из комнаты</button>';
        }
        if (adm) {
            html += '<button type="button" class="pg-btn primary" data-act="start"' + (s.players.length ? '' : ' disabled') + '>Начать игру →</button>';
            html += '<button type="button" class="pg-btn danger" data-act="closeRoom">Закрыть комнату</button>';
        }
        html += '</div></div>';
        return html;
    }

    function htmlHostGame(s) {
        var html = htmlTabs();
        html += '<div class="pg-panel"><h2>Личные карточки</h2><p class="pg-muted">Выберите ученика и выдайте карточку. Ученик видит только свою.</p>';
        s.players.forEach(function (p) {
            html += '<div class="pg-person"><div class="pg-avatar">' + esc((p.name || '?').charAt(0).toUpperCase()) + '</div>'
                + '<div class="id"><strong>' + esc(p.name) + '</strong><small>' + (p.hasCard ? 'Карточка выдана' : 'Ожидает') + '</small></div>'
                + '<button type="button" class="pg-btn small" data-act="deal" data-uid="' + esc(p.userId) + '"' + (p.hasCard ? ' disabled' : '') + '>' + (p.hasCard ? 'Выдана' : 'Выдать →') + '</button>'
                + '</div>';
        });
        html += '<button type="button" class="pg-btn" data-act="dealPending">Раздать тем, кто ещё ждёт</button>';
        html += '<p class="pg-muted" style="margin-top:12px">В колоде осталось: <b>' + s.poolCount + '</b> · использовано: <b>' + s.usedCount + '</b></p>';
        html += '<button type="button" class="pg-btn" data-act="reshuffle">Перемешать колоду</button>';
        html += '<label class="pg-check"><input type="checkbox" data-act="cfgNext"' + (s.config.allowNext ? ' checked' : '') + '><span>Ученики могут менять персонажа</span></label>';
        html += '<button type="button" class="pg-btn primary" data-act="finish">Завершить игру</button>';
        html += '<button type="button" class="pg-btn danger" data-act="closeRoom">Закрыть комнату</button>';
        html += '</div>';
        return html;
    }

    function htmlPlayer(s) {
        var m = myCards[activeMode] || {};
        var open = !!cardOpen[activeMode];
        var html = htmlTabs();
        if (s.status === 'waiting' || s.status === 'lobby' || s.status === 'idle') {
            html += '<div class="pg-panel" style="text-align:center"><div class="pg-seal" style="margin:18px auto">✦</div>'
                + '<h2>Ждём начала игры</h2><p class="pg-muted">Ведущий запустит игру, когда все будут готовы.</p></div>';
            return html;
        }
        if (s.status === 'finished') {
            html += '<div class="pg-panel" style="text-align:center"><div class="pg-seal" style="margin:18px auto">✦</div>'
                + '<h2>Спасибо за игру!</h2><p class="pg-muted">Можно сыграть ещё раз.</p></div>';
            return html;
        }
        if (!m.card) {
            html += '<div class="pg-panel" style="text-align:center"><h2>Карточка ещё не выдана</h2>'
                + '<p class="pg-muted">Ведущий выдаст её вам.</p>'
                + '<button type="button" class="pg-btn" data-act="requestCard">Запросить карточку</button></div>';
            return html;
        }
        html += '<div class="pg-card-scene"><button type="button" class="pg-card' + (open ? ' open' : '') + '" data-act="flip" aria-label="' + (open ? 'Скрыть' : 'Открыть') + ' карточку">'
            + '<div class="pg-face back"><div class="pg-seal">✦</div></div>'
            + '<div class="pg-face front"><b>' + esc(m.card) + '</b></div>'
            + '</button></div>';
        html += '<div class="pg-hint">' + (open ? 'Нажмите ещё раз, чтобы скрыть' : 'Нажмите, чтобы открыть') + '</div>';
        html += '<button type="button" class="pg-btn primary" data-act="next"' + (m.allowNext ? '' : ' disabled') + '>Следующий персонаж →</button>';
        if (!m.allowNext) html += '<p class="pg-muted" style="text-align:center">Смена персонажа выключена</p>';
        html += '<button type="button" class="pg-btn" data-act="hideCard">Скрыть карточку</button>';
        return html;
    }

    function htmlEditor() {
        var html = '<div class="pg-row" style="margin:8px 0"><button type="button" class="pg-chip" data-act="home">← Назад</button></div>';
        html += '<div class="pg-panel"><h2>📚 Колоды персонажей</h2>';
        html += '<div class="pg-row">'
            + '<button type="button" class="pg-chip' + (editorMode === 'croc' ? ' active' : '') + '" data-act="editorTab" data-mode="croc">Крокодил</button>'
            + '<button type="button" class="pg-chip' + (editorMode === 'bunker' ? ' active' : '') + '" data-act="editorTab" data-mode="bunker">Бункер</button>'
            + '</div>';
        if (!isAdminNow()) {
            html += '<p class="pg-muted" style="margin-top:12px">Редактирование колоды доступно администратору.</p></div>';
            return html;
        }
        html += '<div class="pg-label">Новый персонаж</div><div class="pg-row">'
            + '<input class="pg-inp" id="pgNewCard" maxlength="100" placeholder="Название" style="flex:1">'
            + '<button type="button" class="pg-btn small primary" data-act="addCard" style="margin:0">＋</button></div>';
        html += '<div class="pg-row" style="margin-top:14px"><span class="pg-muted">' + editorCards.length + ' персонажей</span>'
            + '<button type="button" class="pg-btn small" data-act="restoreDeck" style="margin:0">Восстановить исходную</button></div>';
        html += '<div class="pg-editor-list">';
        editorCards.forEach(function (n, i) {
            html += '<div class="pg-entry"><span>' + esc(n) + '</span><button type="button" class="pg-btn small danger" data-act="delCard" data-i="' + i + '" style="margin:0">✕</button></div>';
        });
        html += '</div></div>';
        return html;
    }

    function render() {
        var root = rootEl();
        root.className = 'party-game' + (activeMode === 'bunker' ? ' bunker-theme' : '');
        ensureStyles();
        var s = st();
        var html = '';
        if (page === 'editor') html = htmlEditor();
        else if (page === 'home' || (!s && page !== 'player')) html = htmlHome();
        else if (page === 'lobby' && s) html = htmlLobby(s);
        else if (page === 'game' && s) html = isAdminNow() ? htmlHostGame(s) : htmlPlayer(s);
        else if (page === 'player' && s) html = htmlPlayer(s);
        else html = htmlHome();
        root.innerHTML = html;
    }

    function onClick(e) {
        var b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        var a = b.dataset.act;
        try {
            switch (a) {
                case 'home': page = 'home'; render(); break;
                case 'choose':
                    activeMode = b.dataset.mode || 'croc';
                    mode = activeMode;
                    emit('party:getState', { mode: activeMode });
                    page = (states[activeMode] && states[activeMode].status === 'playing') ? (isAdminNow() ? 'game' : 'player') : 'lobby';
                    render();
                    break;
                case 'goCroc': activeMode = 'croc'; emit('party:getState', { mode: 'croc' }); page = 'lobby'; render(); break;
                case 'goBunker': activeMode = 'bunker'; emit('party:getState', { mode: 'bunker' }); page = 'lobby'; render(); break;
                case 'tab':
                    activeMode = b.dataset.mode || 'croc';
                    emit('party:getState', { mode: activeMode });
                    render();
                    break;
                case 'editor':
                    page = 'editor';
                    editorMode = activeMode;
                    emit('party:deckGet', { mode: editorMode });
                    render();
                    break;
                case 'editorTab':
                    editorMode = b.dataset.mode || 'croc';
                    emit('party:deckGet', { mode: editorMode });
                    render();
                    break;
                case 'join': emit('party:join', { mode: activeMode }); break;
                case 'leave': emit('party:leave', { mode: activeMode }); break;
                case 'kick': emit('party:removePlayer', { mode: activeMode, userId: b.dataset.uid }); break;
                case 'start': emit('party:start', { mode: activeMode }); break;
                case 'deal': emit('party:deal', { mode: activeMode, userId: b.dataset.uid }); break;
                case 'dealPending': emit('party:dealPending', { mode: activeMode }); break;
                case 'next': emit('party:next', { mode: activeMode }); cardOpen[activeMode] = false; render(); break;
                case 'flip': flipCard(); break;
                case 'hideCard': cardOpen[activeMode] = false; render(); break;
                case 'requestCard': emit('party:getState', { mode: activeMode }); toast('i', TITLES[activeMode], 'Запрос отправлен ведущему'); break;
                case 'reshuffle': emit('party:reshuffle', { mode: activeMode }); break;
                case 'finish': emit('party:finish', { mode: activeMode }); break;
                case 'closeRoom': emit('party:closeRoom', { mode: activeMode }); page = 'home'; render(); break;
                case 'cfgDist': emit('party:updateConfig', { mode: activeMode, config: { distribution: b.dataset.val } }); break;
                case 'addCard': {
                    var inp = document.getElementById('pgNewCard');
                    var name = inp ? String(inp.value || '').trim() : '';
                    if (!name) { toast('e', 'Колода', 'Введите название'); break; }
                    if (editorCards.some(function (x) { return x.toLowerCase() === name.toLowerCase(); })) {
                        toast('e', 'Колода', 'Такой персонаж уже есть');
                        break;
                    }
                    editorCards.push(name);
                    emit('party:deckSave', { mode: editorMode, cards: editorCards });
                    if (inp) inp.value = '';
                    render();
                    break;
                }
                case 'delCard': {
                    if (editorCards.length <= 1) { toast('e', 'Колода', 'Оставьте хотя бы одного'); break; }
                    editorCards.splice(Number(b.dataset.i), 1);
                    emit('party:deckSave', { mode: editorMode, cards: editorCards });
                    render();
                    break;
                }
                case 'restoreDeck': emit('party:deckRestore', { mode: editorMode }); break;
            }
        } catch (err) {
            toast('e', TITLES[activeMode] || 'Игра', err.message || 'Ошибка');
        }
    }

    function onChange(e) {
        var t = e.target;
        if (t && t.dataset && t.dataset.act === 'cfgNext') {
            emit('party:updateConfig', { mode: activeMode, config: { allowNext: !!t.checked } });
        }
    }

    function init(bridge) {
        BP = bridge || window.BP || {};
        ensureStyles();
        var root = rootEl();
        var host = document.getElementById('secCroc') || document.getElementById('secParty') || document.getElementById('secBunker');
        if (host && !root.closest('#secCroc, #secParty, #secBunker')) {
            host.appendChild(root);
        }
        if (!root._pgBound) {
            root._pgBound = true;
            root.addEventListener('click', onClick);
            root.addEventListener('change', onChange);
        }
        if (BP.onParty) {
            BP.onParty('party:state', function (d) { applyState(d); });
            BP.onParty('party:myCard', function (d) { applyMyCard(d); });
            BP.onParty('party:deck', function (d) {
                if (!d) return;
                if (Array.isArray(d.cards)) {
                    editorCards = d.cards.slice();
                    editorMode = d.mode || editorMode;
                }
                render();
            });
            BP.onParty('party:error', function (d) {
                if (d && d.message) toast('e', 'Party', d.message);
            });
        }
        emit('party:getState', { mode: 'croc' });
        emit('party:getState', { mode: 'bunker' });
        render();
    }

    function onNavigate(s) {
        if (s === 'croc' || s === 'party' || s === 'bunker') {
            activeMode = s === 'bunker' ? 'bunker' : (s === 'croc' ? 'croc' : activeMode);
            emit('party:getState', { mode: 'croc' });
            emit('party:getState', { mode: 'bunker' });
            render();
        }
    }

    window.Party = {
        init: init,
        onNavigate: onNavigate,
        reload: function () {
            emit('party:getState', { mode: 'croc' });
            emit('party:getState', { mode: 'bunker' });
            render();
        },
        setMode: function (m) {
            activeMode = m === 'bunker' ? 'bunker' : 'croc';
            render();
        }
    };
})();
