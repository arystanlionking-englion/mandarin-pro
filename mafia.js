/* Bank Mandarin Pro — встроенный модуль МАФИЯ
 * Секретные карточки, зал ожидания, таймер ведущего.
 * Пользователи и авторизация — только из BANK MANDARIN PRO.
 */
(function () {
    'use strict';

    var BP = null;
    var root = null;
    var state = null;
    var myRole = null;
    var myOut = false;
    var cardOpen = false;
    var showRoles = false;
    var hostRoles = [];
    var audioUnlocked = false;
    var tickTimer = null;
    var modalFn = null;
    var lastVersion = -1;

    var ROLES = {
        mafia: { name: 'МАФИЯ', desc: 'Вы — мафия. Сохраняйте свою роль в секрете.', accent: '#e36b80', glow: '#9b233d77' },
        civilian: { name: 'МИРНЫЙ ЖИТЕЛЬ', desc: 'Вы — мирный житель. Найдите мафию вместе с городом.', accent: '#edc47b', glow: '#ad7c2870' },
        doctor: { name: 'ДОКТОР', desc: 'Вы — доктор. Лечите игроков по правилам ведущего.', accent: '#79d8b2', glow: '#267a6477' },
        commissar: { name: 'КОМИССАР', desc: 'Вы — комиссар. Проверяйте подозреваемых по правилам ведущего.', accent: '#8cb4ff', glow: '#3157a477' }
    };

    var ICONS = {
        mafia: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 80Q60 12 100 80L60 108Z"/><path d="M28 75L47 70L54 79L38 83ZM92 75L73 70L66 79L82 83Z" fill="currentColor"/><path d="M60 84v17M42 54Q60 42 78 54"/></svg>',
        civilian: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3"><path d="M16 103V55L60 24L104 55V103Z"/><path d="M8 57L60 18L112 57"/><rect x="46" y="61" width="18" height="20" rx="2"/><path d="M74 103V75h17v28M12 103h96"/></svg>',
        doctor: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3"><circle cx="60" cy="60" r="48"/><path d="M51 29h18v22h22v18H69v22H51V69H29V51h22z" fill="currentColor" fill-opacity=".25"/></svg>',
        commissar: '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3"><circle cx="60" cy="60" r="49"/><path d="M60 18L72 46L102 49L79 68L86 98L60 81L34 98L41 68L18 49L48 46Z" fill="currentColor" fill-opacity=".25"/><circle cx="60" cy="61" r="8"/></svg>'
    };

    var STYLES = ''
        + '.mafia-game{font-family:Georgia,serif;color:#f8eedc}'
        + '.mafia-game *{box-sizing:border-box}'
        + '.mf-eyebrow{font-size:11px;letter-spacing:.38em;color:#e5bb76;text-align:center}'
        + '.mafia-game .mf-title{font:700 clamp(40px,11vw,64px)/1 Georgia,serif;letter-spacing:.12em;margin:8px 0;color:#f3d89c;text-shadow:0 3px 25px #b17b3b55;text-align:center}'
        + '.mafia-game .mf-sub{color:#c5adac;font-size:13px;letter-spacing:.08em;margin:6px 0;text-align:center}'
        + '.mf-rule{height:1px;background:linear-gradient(90deg,transparent,#b58b57,transparent);margin:10px 0 18px}'
        + '.mafia-game .mf-panel{border:1px solid #9c77525e;background:#ffffff08;border-radius:19px;padding:18px;margin:12px 0;box-shadow:0 12px 28px #00000020}'
        + '.mafia-game .mf-panel h2{font:500 22px Georgia,serif;color:#f0d49b;margin:0 0 13px}'
        + '.mafia-game .mf-muted{color:#b9a8a9;font-size:13px;line-height:1.5}'
        + '.mafia-game .mf-row{display:flex;align-items:center;justify-content:space-between;gap:12px}'
        + '.mafia-game .mf-chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}'
        + '.mafia-game .mf-chip{padding:10px 13px;background:#ffffff08;color:#e9d6bc;border:1px solid #b28b604a;border-radius:12px;cursor:pointer;font:inherit}'
        + '.mafia-game .mf-chip.active{background:#d3a760;color:#201319;border-color:#d3a760;font-weight:800}'
        + '.mafia-game .mf-btn{width:100%;border:1px solid #d2aa71;background:#ffffff07;color:#f3dfbc;min-height:52px;padding:12px;border-radius:14px;font-weight:700;margin-top:10px;cursor:pointer;font:inherit;touch-action:manipulation}'
        + '.mafia-game .mf-btn.primary{background:linear-gradient(120deg,#f2d89d,#c18b45);color:#211318;box-shadow:0 8px 24px #c18b4533}'
        + '.mafia-game .mf-btn.danger{border-color:#a94b5a;color:#ffc3c8}'
        + '.mafia-game .mf-btn.small{width:auto;min-height:40px;padding:8px 12px;margin:0;font-size:13px}'
        + '.mafia-game .mf-btn:disabled{opacity:.38;cursor:default}'
        + '.mafia-game .mf-person{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #ffffff17}'
        + '.mafia-game .mf-person:last-child{border:0}'
        + '.mafia-game .mf-person .mf-identity{flex:1;min-width:0}'
        + '.mafia-game .mf-person strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
        + '.mafia-game .mf-person small{color:#b9a8a9}'
        + '.mafia-game .mf-tag{border-radius:9px;padding:4px 8px;background:#ffffff15;color:#ead0aa;font-size:12px;flex-shrink:0}'
        + '.mafia-game .mf-divider{height:1px;background:#ffffff20;margin:16px 0}'
        + '.mafia-game .mf-center{text-align:center}'
        + '.mafia-game .mf-big{font:500 27px Georgia,serif;color:#f2d89d;text-align:center;margin:25px 0}'
        + '.mafia-game .mf-card-scene{perspective:1100px;margin:16px auto;width:min(82vw,320px);height:min(55dvh,440px);min-height:340px}'
        + '.mafia-game .mf-playing-card{width:100%;height:100%;position:relative;transform-style:preserve-3d;transition:transform .32s cubic-bezier(.2,.8,.3,1);cursor:pointer;will-change:transform;-webkit-tap-highlight-color:transparent}'
        + '.mafia-game .mf-playing-card.open{transform:rotateY(180deg)}'
        + '.mafia-game .mf-face{position:absolute;inset:0;border-radius:23px;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;border:2px solid #cda15f;box-shadow:0 18px 48px #0009}'
        + '.mafia-game .mf-face.back{display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,#75243e,#280e1d 72%)}'
        + '.mafia-game .mf-face:before{content:"";position:absolute;inset:10px;border:1px solid #d9b47477;border-radius:15px;pointer-events:none}'
        + '.mafia-game .mf-seal{border:2px solid #e0b97d;border-radius:50%;width:128px;height:128px;display:grid;place-items:center;font:70px Georgia,serif;color:#efd6a4;box-shadow:0 0 45px #c69d5d2b}'
        + '.mafia-game .mf-back-hint{font-size:14px;letter-spacing:.1em;color:#e6c99b;margin-top:28px}'
        + '.mafia-game .mf-face.front{transform:rotateY(180deg);display:flex;align-items:center;flex-direction:column;justify-content:center;padding:25px 16px;text-align:center;background:radial-gradient(circle at 50% 30%,var(--mf-glow),transparent 63%),linear-gradient(#241622,#120e18);border-color:var(--mf-accent)}'
        + '.mafia-game .mf-face.front .mf-glyph{width:128px;height:128px;display:grid;place-items:center;color:var(--mf-accent);filter:drop-shadow(0 0 18px var(--mf-glow))}'
        + '.mafia-game .mf-glyph svg{width:112px;height:112px}'
        + '.mafia-game .mf-role-name{font:700 clamp(23px,6vw,30px)/1.1 Georgia,serif;margin:10px 0;color:#f7ebdc}'
        + '.mafia-game .mf-role-desc{font-size:14px;color:#dacfc7;line-height:1.5}'
        + '.mafia-game .mf-role-player{color:var(--mf-accent);font-weight:700;margin-top:18px}'
        + '.mafia-game .mf-host-mark{color:#f4d49a;font-size:12px;letter-spacing:.07em;margin-top:10px}'
        + '.mafia-game .mf-timer{font:600 66px Georgia,serif;color:#f3d89c;font-variant-numeric:tabular-nums;text-align:center;margin:12px 0;touch-action:manipulation}'
        + '.mafia-game .mf-timer.ending{color:#f27884}'
        + '.mafia-game .mf-timer.mf-clickable{cursor:pointer;user-select:none;-webkit-user-select:none;border:1px solid #cda15f66;border-radius:18px;padding:14px 5px;background:#d3a7600d}'
        + '.mafia-game .mf-timer.mf-clickable:active{transform:scale(.98)}'
        + '.mafia-game .mf-orbit{position:relative;width:min(100%,420px);aspect-ratio:1;margin:8px auto 14px;border-radius:50%;background:radial-gradient(circle,#8a344225 0,#2d152122 48%,transparent 70%)}'
        + '.mafia-game .mf-orbit:before{content:"";position:absolute;inset:16%;border:1px dashed #d3a76055;border-radius:50%;box-shadow:0 0 55px #b43e4230,inset 0 0 50px #b43e421a}'
        + '.mafia-game .mf-orbit-core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:37%;aspect-ratio:1;border-radius:50%;border:1px solid #d4ad73;background:radial-gradient(circle at 35% 25%,#6f2b42,#200f1c 75%);display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 0 32px #c59b5940;text-align:center;z-index:1}'
        + '.mafia-game .mf-orbit-core b{font:700 clamp(18px,5vw,27px) Georgia,serif;color:#f6d99d}'
        + '.mafia-game .mf-orbit-core small{font-size:11px;color:#d4b8b6;margin-top:6px}'
        + '.mafia-game .mf-orbit-user{position:absolute;transform:translate(-50%,-50%);width:75px;display:flex;flex-direction:column;align-items:center;gap:5px;z-index:2;animation:mfArrive .35s ease both}'
        + '.mafia-game .mf-orbit-avatar{width:49px;height:49px;border-radius:50%;border:2px solid #e5bd7a;background:linear-gradient(145deg,#793449,#291521);display:grid;place-items:center;color:#ffdfa8;font:700 18px Georgia,serif;box-shadow:0 3px 18px #0009;overflow:hidden}'
        + '.mafia-game .mf-orbit-avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%}'
        + '.mafia-game .mf-orbit-user span{max-width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#f6e8d7;text-shadow:0 2px 5px #000}'
        + '.mafia-game .mf-orbit-avatar{position:relative}'
        + '.mafia-game .mf-orbit-avatar .mf-online{position:absolute;right:1px;bottom:1px;width:11px;height:11px;border-radius:50%;background:#71c8a1;border:2px solid #2a1520;box-shadow:0 0 8px #71c8a188}'
        + '.mafia-game .mf-orbit-avatar .mf-online.off{background:#8a7a7a;box-shadow:none}'
        + '.mafia-game .mf-orbit.dense .mf-orbit-user{width:58px}'
        + '.mafia-game .mf-orbit.dense .mf-orbit-avatar{width:36px;height:36px;font-size:13px}'
        + '.mafia-game .mf-orbit.dense .mf-orbit-user span{max-width:58px;font-size:9px}'
        + '.mafia-game .mf-orbit.very-dense .mf-orbit-user{width:48px;gap:2px}'
        + '.mafia-game .mf-orbit.very-dense .mf-orbit-avatar{width:28px;height:28px;font-size:11px;border-width:1px}'
        + '.mafia-game .mf-orbit.very-dense .mf-orbit-user span{max-width:48px;font-size:8px}'
        + '.mafia-game .mf-orbit.very-dense .mf-orbit-avatar .mf-online{width:8px;height:8px;border-width:1px}'
        + '.mafia-game .mf-player-timer{font:600 40px Georgia,serif;color:#f3d89c;font-variant-numeric:tabular-nums;text-align:center;margin:8px 0 2px}'
        + '.mafia-game .mf-player-timer.ending{color:#f27884}'
        + '.mafia-game .mf-player-timer small{display:block;font:400 11px Georgia,serif;letter-spacing:.14em;color:#b9a8a9;margin-top:2px}'
        + '.mafia-game .mf-orbit-empty{position:absolute;left:50%;top:84%;transform:translateX(-50%);font-size:12px;color:#b9a8a9;text-align:center}'
        + '.mafia-game .mf-notice{background:#c1884e18;border:1px solid #b78b536b;border-radius:13px;padding:12px;font-size:13px;color:#e8c9a5;line-height:1.5;margin:12px 0}'
        + '.mafia-game.mf-overlay,.mafia-game .mf-overlay{position:fixed;inset:0;z-index:20000;background:#08050bd9;display:grid;place-items:center;padding:18px}'
        + '.mafia-game.mf-dialog,.mafia-game .mf-dialog{width:min(100%,390px);padding:23px;border-radius:18px;background:#211623;border:1px solid #c89d62;position:relative;z-index:20001}'
        + '.mafia-game.mf-dialog h2,.mafia-game .mf-dialog h2{margin:0 0 12px;font:500 23px Georgia,serif}'
        + '.mafia-game .mf-actions{display:flex;gap:10px}'
        + '.mafia-game .mf-actions button{flex:1}'
        + '@keyframes mfArrive{from{opacity:0;scale:.8}to{opacity:1;scale:1}}'
        + '@media(max-width:390px){.mafia-game .mf-orbit-user{width:63px}.mafia-game .mf-orbit-avatar{width:40px;height:40px;font-size:15px}.mafia-game .mf-orbit-user span{max-width:66px;font-size:10px}.mafia-game .mf-card-scene{height:390px}}'
        + '@media(prefers-reduced-motion:reduce){.mafia-game .mf-playing-card{transition:none}}';

    function ensureStyles() {
        if (document.getElementById('mafiaStyles')) return;
        var st = document.createElement('style');
        st.id = 'mafiaStyles';
        st.textContent = STYLES;
        document.head.appendChild(st);
    }

    function esc(s) {
        if (BP && BP.esc) return BP.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function toast(type, title, body) {
        if (BP && BP.toast) BP.toast(type, title, body);
    }

    function fmt(n) {
        n = Math.max(0, Math.floor(n || 0));
        return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
    }

    function timerLeft() {
        if (!state || !state.game) return 0;
        var t = state.game.timer || { left: 0, running: false, endAt: 0 };
        if (t.running && t.endAt) return Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
        return Math.max(0, t.left || 0);
    }

    function me() {
        return (state && state.me) || {};
    }

    function isHost() { return !!me().isHost; }
    function isAdminNow() {
        var clientAdmin = false;
        if (BP && BP.isAdmin) { try { clientAdmin = !!BP.isAdmin(); } catch (e) {} }
        return clientAdmin || !!me().isAdmin || !!(state && state.canManage);
    }

    function emit(ev, data) {
        var payload = data || {};
        try {
            var t = localStorage.getItem('pb_admin_token');
            if (t && !payload.adminToken) payload.adminToken = t;
        } catch (e) {}
        if (BP && BP.mafiaEmit) BP.mafiaEmit(ev, payload);
    }

    function chimeUnlock() {
        if (audioUnlocked) return;
        try {
            var C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            var a = new C();
            if (a.resume) a.resume();
            audioUnlocked = true;
            setTimeout(function () { try { a.close(); } catch (e) {} }, 300);
        } catch (e) {}
    }

    function chime() {
        try {
            var C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            var a = new C();
            if (a.state === 'suspended' && a.resume) a.resume();
            [523.25, 659.25, 783.99, 1046.5].forEach(function (hz, i) {
                var o = a.createOscillator(), g = a.createGain(), t = a.currentTime + i * 0.18;
                o.type = 'sine';
                o.frequency.value = hz;
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.15, t + 0.025);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
                o.connect(g); g.connect(a.destination);
                o.start(t); o.stop(t + 0.78);
            });
            setTimeout(function () { try { a.close(); } catch (e) {} }, 2000);
        } catch (e) {}
    }

    function heading(sub) {
        return '<header class="mf-brand"><div class="mf-eyebrow">MANDARIN PRO</div><h1 class="mf-title">МАФИЯ</h1><p class="mf-sub">' + esc(sub) + '</p></header><div class="mf-rule"></div>';
    }

    function button(label, act, cls, extra) {
        return '<button type="button" class="mf-btn ' + (cls || '') + '" data-act="' + act + '"' + (extra || '') + '>' + label + '</button>';
    }

    function avatarHtml(p, sizeClass) {
        if (p.photo) return '<img src="' + esc(p.photo) + '" alt="">';
        return esc((p.name || '?').trim().charAt(0).toUpperCase());
    }

    function orbitHtml(list) {
        // Show every joined participant (online and offline) so the waiting-room list stays complete
        var a = (list || []).filter(function (p) { return p && p.userId; }), n = a.length;
        var density = n >= 14 ? ' very-dense' : (n >= 9 ? ' dense' : '');
        var users = a.map(function (p, i) {
            var ang = (-90 + i * 360 / Math.max(n, 1)) * Math.PI / 180;
            var x = 50 + 42 * Math.cos(ang), y = 50 + 42 * Math.sin(ang);
            var off = p.online === false;
            return '<div class="mf-orbit-user" style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%;animation-delay:' + Math.min(i * 40, 400) + 'ms">'
                + '<div class="mf-orbit-avatar">' + avatarHtml(p)
                + '<i class="mf-online' + (off ? ' off' : '') + '" title="' + (off ? 'Не в сети' : 'На связи') + '"></i></div>'
                + '<span title="' + esc(p.name) + '">' + esc(p.name) + '</span></div>';
        }).join('');
        return '<div class="mf-orbit' + density + '"><div class="mf-orbit-core"><b>МАФИЯ</b><small>Ожидание начала игры · ' + n + ' уч.</small></div>' + users
            + (n === 0 ? '<div class="mf-orbit-empty">Пока никого нет</div>' : '')
            + '</div>';
    }

    function cardHtml() {
        var roleKey = myRole || 'civilian';
        var r = ROLES[roleKey] || ROLES.civilian;
        var host = isHost();
        return '<div class="mf-card-scene"><div class="mf-playing-card ' + (cardOpen ? 'open' : '') + '" id="mfCard" role="button" tabindex="0" aria-label="Открыть или скрыть свою карту">'
            + '<div class="mf-face back"><div class="mf-seal">密</div><div class="mf-back-hint">НАЖМИ НА КАРТУ</div></div>'
            + '<div class="mf-face front" style="--mf-accent:' + r.accent + ';--mf-glow:' + r.glow + '">'
            + '<div class="mf-glyph">' + (ICONS[roleKey] || ICONS.civilian) + '</div>'
            + '<div class="mf-role-name">' + r.name + '</div>'
            + '<div class="mf-role-desc">' + r.desc + '</div>'
            + '<div class="mf-role-player">' + esc(me().name || (BP && BP.getUser && BP.getUser() ? BP.getUser().name : '')) + '</div>'
            + (host ? '<div class="mf-host-mark">✦ ВЫ ТАКЖЕ ВЕДУЩИЙ ✦</div>' : '')
            + '</div></div></div>'
            + '<p class="mf-center mf-muted">Нажмите на карту, чтобы открыть или скрыть её</p>';
    }

    function hostPanelHtml() {
        var t = state.game.timer || { duration: 90, left: 90, running: false, endAt: 0 };
        var left = timerLeft();
        var players = (state.game && state.game.players) || [];
        var hm = (state.game && state.game.hostMode) || 'both';
        var modeNote = hm === 'host' ? 'Вы ведущий без личной карточки.'
            : hm === 'player' ? 'Вы ведущий этой партии.'
            : 'Вы ведущий и одновременно участвуете в игре.';
        var out = '<section class="mf-panel"><h2>Управление ведущего</h2>'
            + '<p class="mf-muted">' + modeNote + '</p>'
            + '<div class="mf-chips">' + [60, 90, 120].map(function (n) {
                return '<button type="button" class="mf-chip ' + (t.duration === n ? 'active' : '') + '" data-act="duration" data-val="' + n + '">' + fmt(n) + '</button>';
            }).join('') + '</div>'
            + '<div id="mfTimer" class="mf-timer mf-clickable" data-act="timerToggle" role="button" tabindex="0">' + fmt(left) + '</div>'
            + '<p class="mf-center mf-muted">Нажмите на цифры: старт / пауза / продолжить</p>'
            + button('Сбросить таймер', 'resetTimer')
            + '<div class="mf-divider"></div>'
            + '<div class="mf-row"><h2 style="margin:0">Участники</h2>'
            + '<button type="button" class="mf-btn small" data-act="roles">' + (showRoles ? 'Скрыть роли' : 'Посмотреть роли') + '</button></div>';
        players.forEach(function (p) {
            var roleName = '';
            if (showRoles && hostRoles && hostRoles.length) {
                var hr = hostRoles.find(function (x) { return x.userId === p.userId; });
                roleName = hr ? ((ROLES[hr.role] || {}).name || '') : '';
            }
            out += '<div class="mf-person"><div class="mf-identity"><strong>' + esc(p.name) + '</strong><small>'
                + (p.out ? 'Выбыл' : 'Активен')
                + (showRoles && roleName ? ' · ' + esc(roleName) : '')
                + (showRoles && !roleName && hostRoles.length ? ' · роль скрыта' : '')
                + '</small></div>'
                + '<button type="button" class="mf-btn small ' + (p.out ? '' : 'danger') + '" data-act="exclude" data-val="' + esc(p.userId) + '">'
                + (p.out ? 'Вернуть' : 'Исключить') + '</button></div>';
        });
        out += '</section>';
        return out;
    }

    function hostModeHtml(st) {
        var hm = (st.config && st.config.hostMode) || 'both';
        return '<div class="mf-row"><span class="mf-muted">Режим администратора</span></div>'
            + '<div class="mf-chips">'
            + '<button type="button" class="mf-chip ' + (hm === 'host' ? 'active' : '') + '" data-act="hostMode" data-val="host">Ведущий</button>'
            + '<button type="button" class="mf-chip ' + (hm === 'player' ? 'active' : '') + '" data-act="hostMode" data-val="player">Игрок</button>'
            + '<button type="button" class="mf-chip ' + (hm === 'both' ? 'active' : '') + '" data-act="hostMode" data-val="both">Ведущий + игрок</button>'
            + '</div>'
            + '<p class="mf-muted">Ведущий — только управление. Игрок — карточка наравне со всеми. Ведущий + игрок — управление и карточка.</p>';
    }

    function adminControlsHtml(st, title) {
        var out = '<section class="mf-panel"><h2>' + (title || 'Панель администратора') + '</h2>';
        if (st.status === 'playing') {
            out += '<p class="mf-muted">Вы управляете игрой. Можете завершить партию, сбросить комнату или вернуться к настройкам.</p>';
            out += button('Завершить партию и открыть ожидание', 'finish', 'danger');
            out += button('Сбросить комнату', 'resetRoom', 'danger');
        } else if (st.status === 'lobby') {
            out += '<p class="mf-muted">Настройки можно менять до начала партии.</p>';
        }
        return out;
    }

    function render() {
        if (!root) return;
        ensureStyles();
        var u = BP && BP.getUser ? BP.getUser() : null;
        var st = state || { status: 'idle', lobbyOpen: false, joined: [], game: null };
        var my = me();
        var joined = !!my.inLobby;
        var isPlayer = !!my.isPlayer;
        var host = !!my.isHost;
        var admin = isAdminNow();
        var out = '';

        if (!u && !admin) {
            out = heading('СЕКРЕТНЫЕ КАРТЫ')
                + '<section class="mf-panel mf-center"><p class="mf-muted">Войдите в BANK MANDARIN PRO, чтобы участвовать в игре.</p></section>';
            root.innerHTML = out;
            return;
        }

        if (st.status === 'idle') {
            out = heading('СЕКРЕТНЫЕ КАРТЫ');
            if (admin) {
                out += '<section class="mf-panel"><h2>Панель администратора</h2>'
                    + '<p class="mf-muted">Настройте комнату и откройте ожидание для учеников.</p>'
                    + '<label class="mf-row">Доктор <input type="checkbox" data-setting="doctor" ' + ((st.config && st.config.doctor) ? 'checked' : '') + '></label>'
                    + '<div class="mf-divider"></div>'
                    + '<label class="mf-row">Комиссар <input type="checkbox" data-setting="commissar" ' + ((st.config && st.config.commissar) ? 'checked' : '') + '></label>'
                    + '<div class="mf-divider"></div>'
                    + '<label class="mf-row">Ведущий может завершать <input type="checkbox" data-setting="allowHostFinish" ' + (!st.config || st.config.allowHostFinish !== false ? 'checked' : '') + '></label>'
                    + '<div class="mf-divider"></div>'
                    + '<div class="mf-row"><span class="mf-muted">Мафиози</span><div class="mf-chips">'
                    + '<button type="button" class="mf-chip ' + (!st.config || st.config.mafiaMode !== 'fixed' ? 'active' : '') + '" data-act="mafiaMode" data-val="auto">Авто (⅓)</button>'
                    + '<button type="button" class="mf-chip ' + (st.config && st.config.mafiaMode === 'fixed' ? 'active' : '') + '" data-act="mafiaMode" data-val="fixed">Фикс.</button>'
                    + '</div></div>'
                    + (st.config && st.config.mafiaMode === 'fixed'
                        ? '<div class="mf-chips">' + [1, 2, 3, 4].map(function (n) {
                            return '<button type="button" class="mf-chip ' + (Number(st.config.mafiaCount) === n ? 'active' : '') + '" data-act="mafiaCount" data-val="' + n + '">' + n + '</button>';
                        }).join('') + '</div>'
                        : '')
                    + '<div class="mf-divider"></div>'
                    + '<div class="mf-row"><span class="mf-muted">Время обсуждения</span></div>'
                    + '<div class="mf-chips">' + [60, 90, 120].map(function (n) {
                        return '<button type="button" class="mf-chip ' + ((st.config ? st.config.duration : 90) === n ? 'active' : '') + '" data-act="cfgDuration" data-val="' + n + '">' + fmt(n) + '</button>';
                    }).join('') + '</div>'
                    + hostModeHtml(st)
                    + '<p class="mf-muted">Мафиози и ведущий выбираются автоматически. Количество игроков — по числу вошедших.</p>'
                    + button('ОТКРЫТЬ КОМНАТУ', 'prepare', 'primary')
                    + '</section>';
            } else {
                out += '<section class="mf-panel mf-center"><p class="mf-muted">Администратор готовит комнату. Скоро начнём!</p></section>';
            }
            root.innerHTML = out;
            bind();
            return;
        }

        // Lobby
        if (st.status === 'lobby') {
            out = heading('СЕКРЕТНЫЕ КАРТЫ');
            out += '<section class="mf-panel mf-center"><h2>' + (st.lobbyOpen ? 'Зал ожидания' : 'Комната готовится') + '</h2>'
                + '<p class="mf-muted">' + (st.lobbyOpen ? 'Участники появляются по кругу по мере входа' : 'Администратор готовит комнату. Скоро начнём!') + '</p>'
                + orbitHtml(st.joined)
                + '</section>';

            if (admin) {
                out += '<section class="mf-panel"><h2>Панель администратора</h2>'
                    + '<p class="mf-muted">Настройки можно менять до начала партии.</p>'
                    + '<label class="mf-row">Доктор <input type="checkbox" data-setting="doctor" ' + ((st.config && st.config.doctor) ? 'checked' : '') + '></label>'
                    + '<div class="mf-divider"></div>'
                    + '<label class="mf-row">Комиссар <input type="checkbox" data-setting="commissar" ' + ((st.config && st.config.commissar) ? 'checked' : '') + '></label>'
                    + '<div class="mf-divider"></div>'
                    + '<label class="mf-row">Ведущий может завершать <input type="checkbox" data-setting="allowHostFinish" ' + (!st.config || st.config.allowHostFinish !== false ? 'checked' : '') + '></label>'
                    + '<div class="mf-divider"></div>'
                    + '<div class="mf-row"><span class="mf-muted">Мафиози</span><div class="mf-chips">'
                    + '<button type="button" class="mf-chip ' + (!st.config || st.config.mafiaMode !== 'fixed' ? 'active' : '') + '" data-act="mafiaMode" data-val="auto">Авто (⅓)</button>'
                    + '<button type="button" class="mf-chip ' + (st.config && st.config.mafiaMode === 'fixed' ? 'active' : '') + '" data-act="mafiaMode" data-val="fixed">Фикс.</button>'
                    + '</div></div>'
                    + (st.config && st.config.mafiaMode === 'fixed'
                        ? '<div class="mf-chips">' + [1, 2, 3, 4].map(function (n) {
                            return '<button type="button" class="mf-chip ' + (Number(st.config.mafiaCount) === n ? 'active' : '') + '" data-act="mafiaCount" data-val="' + n + '">' + n + '</button>';
                        }).join('') + '</div>'
                        : '')
                    + '<div class="mf-divider"></div>'
                    + '<div class="mf-row"><span class="mf-muted">Время обсуждения</span></div>'
                    + '<div class="mf-chips">' + [60, 90, 120].map(function (n) {
                        return '<button type="button" class="mf-chip ' + ((st.config ? st.config.duration : 90) === n ? 'active' : '') + '" data-act="cfgDuration" data-val="' + n + '">' + fmt(n) + '</button>';
                    }).join('') + '</div>'
                    + hostModeHtml(st)
                    + '<p class="mf-muted">Комната открыта · участников: ' + (st.joined ? st.joined.length : 0) + '</p>'
                    + button('НАЧАТЬ ПАРТИЮ · РАЗДАТЬ КАРТЫ', 'start', 'primary')
                    + (!joined && u ? button('Присоединиться самому как игрок', 'join') : '')
                    + button('Сбросить комнату', 'resetRoom', 'danger')
                    + '</section>';
            } else if (!joined) {
                out += '<section class="mf-panel mf-center"><p class="mf-muted">'
                    + (st.lobbyOpen ? 'Вы можете войти в комнату' : 'Ожидайте подготовки комнаты администратором')
                    + '</p>'
                    + (st.lobbyOpen ? button('ВОЙТИ В КОМНАТУ', 'join', 'primary') : '')
                    + '</section>';
            } else {
                out += '<p class="mf-center mf-muted">Вы в комнате. Ожидайте начала партии.</p>';
                out += '<div class="mf-center">' + button('Покинуть комнату', 'leave', 'small') + '</div>';
            }
            root.innerHTML = out;
            bind();
            return;
        }

        // Playing — only if a real deal exists (not a stale/phantom game)
        var dealPlayers = (st.game && st.game.players) || [];
        var realPlayers = dealPlayers.filter(function (p) { return p && p.userId; });
        if (!realPlayers.length) {
            out = heading('СЕКРЕТНЫЕ КАРТЫ')
                + '<section class="mf-panel mf-center"><h2>Партия ещё не запущена</h2>'
                + '<p class="mf-muted">Ожидайте, пока администратор запустит раздачу.</p>'
                + '</section>';
            if (admin) {
                out += '<section class="mf-panel"><h2>Панель администратора</h2>'
                    + '<p class="mf-muted">Состояние игры требует сброса. Вы можете завершить зависшую партию или сбросить комнату.</p>'
                    + button('Завершить партию и открыть ожидание', 'finish', 'danger')
                    + button('Сбросить комнату', 'resetRoom', 'danger')
                    + '</section>';
            }
            root.innerHTML = out;
            bind();
            return;
        }
        if (!isPlayer) {
            out = heading('СЕКРЕТНЫЕ КАРТЫ')
                + '<section class="mf-panel mf-center"><h2>' + (host ? 'Вы ведущий партии' : 'Партия уже началась') + '</h2>'
                + '<p class="mf-muted">' + (host ? 'Вы управляете игрой без личной карточки.' : 'Дождитесь следующей раздачи.') + '</p>'
                + orbitHtml(realPlayers)
                + '</section>';
            if (host) out += hostPanelHtml();
            if (admin) {
                out += '<section class="mf-panel"><h2>Панель администратора</h2>'
                    + '<p class="mf-muted">Вы управляете игрой. Можете завершить партию или сбросить комнату.</p>'
                    + button('Завершить партию и открыть ожидание', 'finish', 'danger')
                    + button('Сбросить комнату', 'resetRoom', 'danger')
                    + '</section>';
            } else if (host && (!st.config || st.config.allowHostFinish !== false)) {
                out += button('Завершить партию и открыть ожидание', 'finish', 'danger');
            }
            root.innerHTML = out;
            bind();
            return;
        }

        out = '<p class="mf-center mf-muted">' + esc((u && u.name) || (my.name || '')) + '</p>';
        if (!host && state.game && state.game.timer) {
            var pl = timerLeft();
            var pt = state.game.timer;
            if (pt.running || (pl > 0 && pl < (pt.duration || 90))) {
                out += '<div class="mf-player-timer' + (pl <= 10 ? ' ending' : '') + '" id="mfPlayerTimer">' + fmt(pl)
                    + '<small>ОБСУЖДЕНИЕ</small></div>';
            }
        }
        if (myOut) {
            out += '<div class="mf-big">ВЫ ВЫБЫЛИ ИЗ ИГРЫ</div>';
        } else {
            out += cardHtml();
        }
        if (host) out += hostPanelHtml();
        if (admin) {
            out += adminControlsHtml(st, 'Панель администратора');
        } else if (host && (!st.config || st.config.allowHostFinish !== false)) {
            out += button('Завершить партию и открыть ожидание', 'finish', 'danger');
        }
        root.innerHTML = out;
        bind();
    }

    function bind() {
        if (!root) return;
        // click handled via delegation below (set once)
    }

    function ask(msg, fn) {
        // Native confirm — always works, no DOM/CSS dependency
        if (window.confirm(msg)) {
            try { fn(); } catch (e) {}
            return;
        }
    }

    function onClick(e) {
        var card = e.target.closest && e.target.closest('#mfCard');
        if (card) {
            chimeUnlock();
            cardOpen = !cardOpen;
            card.classList.toggle('open', cardOpen);
            return;
        }
        var mb = e.target.closest && e.target.closest('[data-modal]');
        if (mb) {
            var host = document.getElementById('mafiaModal');
            var f = modalFn;
            modalFn = null;
            if (host) host.innerHTML = '';
            if (mb.dataset.modal === 'yes' && f) f();
            return;
        }
        var b = e.target.closest && e.target.closest('[data-act]');
        if (!b) return;
        var act = b.dataset.act;
        chimeUnlock();
        switch (act) {
            case 'prepare':
                emit('mafia:createRoom', { config: readConfigFromDom() });
                break;
            case 'join':
                emit('mafia:join', {});
                break;
            case 'leave':
                emit('mafia:leave', {});
                break;
            case 'start':
                emit('mafia:start', {});
                break;
            case 'duration':
                emit('mafia:timer', { action: 'set', duration: Number(b.dataset.val) });
                break;
            case 'cfgDuration':
                emit('mafia:updateConfig', { config: { duration: Number(b.dataset.val) } });
                break;
            case 'mafiaMode':
                emit('mafia:updateConfig', { config: { mafiaMode: b.dataset.val } });
                break;
            case 'mafiaCount':
                emit('mafia:updateConfig', { config: { mafiaCount: Number(b.dataset.val), mafiaMode: 'fixed' } });
                break;
            case 'hostMode':
                emit('mafia:updateConfig', { config: { hostMode: b.dataset.val } });
                break;
            case 'timerToggle':
                emit('mafia:timer', { action: 'toggle' });
                break;
            case 'resetTimer':
                emit('mafia:timer', { action: 'reset' });
                break;
            case 'roles':
                if (showRoles) {
                    showRoles = false;
                    hostRoles = [];
                    render();
                } else {
                    emit('mafia:requestRoles', {});
                }
                break;
            case 'exclude':
                (function () {
                    var id = b.dataset.val;
                    var players = (state && state.game && state.game.players) || [];
                    var p = players.find(function (x) { return x.userId === id; });
                    if (!p) return;
                    ask((p.out ? 'Вернуть ' : 'Исключить ') + p.name + '?', function () {
                        emit('mafia:exclude', { userId: id, out: !p.out });
                    });
                })();
                break;
            case 'finish':
                ask('Завершить партию? Все ученики вернутся в ожидание.', function () {
                    emit('mafia:finish', {});
                });
                break;
            case 'resetRoom':
                ask('Сбросить комнату полностью? Участники и настройки будут очищены.', function () {
                    emit('mafia:reset', {});
                });
                break;
        }
    }

    function onChange(e) {
        var setting = e.target.dataset && e.target.dataset.setting;
        if (setting) {
            var cfg = {};
            cfg[setting] = !!e.target.checked;
            emit('mafia:updateConfig', { config: cfg });
        }
    }

    function onKeydown(e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target && (e.target.id === 'mfCard' || e.target.id === 'mfTimer')) {
            e.preventDefault();
            e.target.click();
        }
    }

    function readConfigFromDom() {
        var cfg = {};
        if (!root) return cfg;
        var doctor = root.querySelector('[data-setting="doctor"]');
        var commissar = root.querySelector('[data-setting="commissar"]');
        var finish = root.querySelector('[data-setting="allowHostFinish"]');
        if (doctor) cfg.doctor = !!doctor.checked;
        if (commissar) cfg.commissar = !!commissar.checked;
        if (finish) cfg.allowHostFinish = !!finish.checked;
        var modeBtn = root.querySelector('[data-act="mafiaMode"].active');
        if (modeBtn) cfg.mafiaMode = modeBtn.dataset.val;
        var countBtn = root.querySelector('[data-act="mafiaCount"].active');
        if (countBtn) cfg.mafiaCount = Number(countBtn.dataset.val);
        var durBtn = root.querySelector('[data-act="cfgDuration"].active');
        if (durBtn) cfg.duration = Number(durBtn.dataset.val);
        var hostModeBtn = root.querySelector('[data-act="hostMode"].active');
        if (hostModeBtn) cfg.hostMode = hostModeBtn.dataset.val;
        return cfg;
    }

    function tick() {
        if (!root || !state || state.status !== 'playing') return;
        var left = timerLeft();
        var el = document.getElementById('mfTimer');
        if (el) {
            el.textContent = fmt(left);
            el.classList.toggle('ending', left <= 10);
        }
        var pl = document.getElementById('mfPlayerTimer');
        if (pl) {
            pl.childNodes[0].textContent = fmt(left);
            pl.classList.toggle('ending', left <= 10);
        }
    }

    function startTicker() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = setInterval(function () {
            var left = timerLeft();
            // end-of-countdown chime (once)
            if (state && state.game && state.game.timer && state.game.timer.running && left === 0) {
                state.game.timer.running = false;
                state.game.timer.left = 0;
                chime();
            }
            tick();
        }, 250);
    }

    function applyState(payload) {
        if (!payload) return;
        var prevStarted = state && state.game ? (state.game.startedAt || 0) : 0;
        var nextStarted = payload.game ? (payload.game.startedAt || 0) : 0;
        state = payload;
        if (payload.me) {
            if (payload.me.myRole) myRole = payload.me.myRole;
            else if (payload.status !== 'playing') myRole = null;
            myOut = !!payload.me.myOut;
        }
        // Reset local card/host-role peek when the deal changes
        if (payload.version !== lastVersion || prevStarted !== nextStarted) {
            lastVersion = payload.version;
            if (payload.status !== 'playing' || prevStarted !== nextStarted) {
                cardOpen = false;
                showRoles = false;
                hostRoles = [];
                if (payload.status !== 'playing') {
                    myRole = null;
                    myOut = false;
                }
            }
        }
        render();
    }

    function init(bridge) {
        BP = bridge || window.BP || {};
        ensureStyles();
        root = document.getElementById('mafiaRoot');
        if (!root) {
            root = document.createElement('div');
            root.id = 'mafiaRoot';
        }
        if (!root.closest('#secMafia') && document.getElementById('secMafia')) {
            document.getElementById('secMafia').appendChild(root);
        }
        root.classList.add('mafia-game');
        if (!root._mfBound) {
            root._mfBound = true;
            root.addEventListener('click', onClick);
            root.addEventListener('change', onChange);
            root.addEventListener('keydown', onKeydown);
        }
        var modalHost = document.getElementById('mafiaModal');
        if (!modalHost) {
            modalHost = document.createElement('div');
            modalHost.id = 'mafiaModal';
            modalHost.className = 'mafia-game';
            document.body.appendChild(modalHost);
        }
        if (!modalHost.classList.contains('mafia-game')) modalHost.classList.add('mafia-game');
        if (!modalHost._mfBound) {
            modalHost._mfBound = true;
            modalHost.addEventListener('click', onClick);
        }

        if (BP.onMafia) {
            BP.onMafia('mafia:state', function (d) { applyState(d); });
            BP.onMafia('mafia:myRole', function (d) {
                if (!d) return;
                myRole = d.role;
                myOut = !!d.out;
                render();
            });
            BP.onMafia('mafia:roles', function (d) {
                if (!d || d.denied) {
                    toast('w', 'Мафия', 'Роли доступны только ведущему.');
                    return;
                }
                hostRoles = d.roles || [];
                showRoles = true;
                render();
            });
            BP.onMafia('mafia:error', function (d) {
                if (d && d.message) toast('e', 'Мафия', d.message);
            });
            BP.onMafia('mafia:timerEnd', function () {
                if (state && state.game && state.game.timer) {
                    state.game.timer.running = false;
                    state.game.timer.left = 0;
                    state.game.timer.endAt = 0;
                }
                chime();
                tick();
            });
        }
        startTicker();
    }

    function onNavigate(s) {
        if (s === 'mafia') {
            if (BP && BP.mafiaEmit) BP.mafiaEmit('mafia:getState', {});
            render();
        }
    }

    window.Mafia = {
        init: init,
        onNavigate: onNavigate,
        reload: function () {
            if (BP && BP.mafiaEmit) BP.mafiaEmit('mafia:getState', {});
        }
    };
})();
