const fs = require('fs');
const path = require('path');

const refPath = String.raw`C:\Users\狮子\Desktop\futcion\сканер_кьр_терминал_игровой_банк_работает_отилчно.html`;
const mainPath = String.raw`C:\Users\狮子\qwerty\personal-bank\index.html`;

// Read reference file
const refContent = fs.readFileSync(refPath, 'utf-8');
const refLines = refContent.split('\n');

// Extract QRCode.js (line 608, index 607)
const qrcodeLine = refLines[607];
console.log('QRCode.js length:', qrcodeLine.length);

// Extract jsQR (lines 611 to closing </script>, indices 610 to end)
let jsqrEnd = -1;
for (let i = 610; i < refLines.length; i++) {
    if (refLines[i].trim() === '</script>') {
        jsqrEnd = i;
        break;
    }
}
const jsqrContent = refLines.slice(610, jsqrEnd + 1).join('\n');
console.log('jsQR content length:', jsqrContent.length);

// Read main file
let main = fs.readFileSync(mainPath, 'utf-8');
const mainLines = main.split('\n');
console.log('Main file lines:', mainLines.length);

// ============================================================
// STEP 1: Remove CDN script tag (line 12, index 11)
// ============================================================
const cdnLine = '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>';
const cdnLineIdx = mainLines.findIndex(l => l.includes('qrcodejs@1.0.0'));
if (cdnLineIdx >= 0) {
    console.log('Found CDN script at line', cdnLineIdx + 1);
    mainLines.splice(cdnLineIdx, 1);
    console.log('Removed CDN script tag');
} else {
    console.log('WARNING: CDN script tag not found!');
}

// ============================================================
// STEP 2: Add inline QRCode.js and jsQR after existing CDN scripts
// Find the line after lucide CDN (line 11, index 10)
// ============================================================
const lucideIdx = mainLines.findIndex(l => l.includes('unpkg.com/lucide'));
if (lucideIdx >= 0) {
    console.log('Found lucide CDN at line', lucideIdx + 1);
    // Insert after lucide line
    const insertIdx = lucideIdx + 1;
    mainLines.splice(insertIdx, 0,
        '    <script>\n    /* Embedded QRCode.js (davidshimjs/qrcodejs) - inline, no CDN needed */\n    ' + qrcodeLine + '\n    </script>',
        '    <script>\n    ' + jsqrContent + '\n    </script>'
    );
    console.log('Inserted QRCode.js and jsQR inline scripts after line', lucideIdx + 1);
} else {
    console.log('WARNING: lucide CDN not found!');
}

// ============================================================
// STEP 3: Add scanner CSS before </style> tag
// ============================================================
const scannerCSS = `
/* === QR SCANNER OVERLAY === */
.qr-scanner-overlay{
    position:fixed;inset:0;z-index:10000;display:none;background:#000;
}
.qr-scanner-overlay.open{display:block}
.qr-scanner-stage{
    position:absolute;inset:0;display:none;background:#000;overflow:hidden;
}
.qr-scanner-stage.active{display:block}
.qr-scanner-stage video{
    position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
}
.qr-scanner-stage .qr-scan-frame{
    position:absolute;inset:18% 12%;border:2px solid var(--accent);border-radius:20px;
    box-shadow:0 0 0 999px rgba(0,0,0,0.45);pointer-events:none;
}
.qr-scanner-stage .qr-scan-laser{
    position:absolute;left:12%;right:12%;top:18%;height:2px;
    background:linear-gradient(90deg,transparent,var(--accent),transparent);
    animation:qrSweep2 1.8s ease-in-out infinite;pointer-events:none;
}
@keyframes qrSweep2{
    0%{top:18%;opacity:0.2}
    50%{top:82%;opacity:1}
    100%{top:18%;opacity:0.2}
}
.qr-scanner-icon-btn{
    position:absolute;top:18px;width:44px;height:44px;border-radius:50%;
    background:rgba(11,14,20,0.82);border:1px solid rgba(249,115,22,0.35);color:var(--accent);
    font-size:19px;padding:0;display:flex;align-items:center;justify-content:center;z-index:5;cursor:pointer;
}
.qr-scanner-close-btn{right:18px;font-size:24px}
.qr-charge-stage .qr-scanner-close-btn{left:18px;right:auto}
.qr-camera-select{
    position:absolute;top:18px;left:18px;z-index:5;
    display:flex;align-items:center;gap:2px;
    background:rgba(11,14,20,0.82);border:1px solid rgba(249,115,22,0.35);
    border-radius:22px;padding:4px;
}
.qr-camera-select button{
    border:none;background:transparent;color:var(--dim);
    font-family:system-ui,sans-serif;font-size:12px;font-weight:600;
    padding:8px 12px;border-radius:18px;display:flex;align-items:center;gap:6px;
    cursor:pointer;transition:background 0.15s ease,color 0.15s ease;
}
.qr-camera-select button .cam-ic{font-size:14px;line-height:1}
.qr-camera-select button.active{background:var(--accent);color:#191307}
.qr-camera-select button:disabled{opacity:0.4}
.qr-scan-status-float{
    position:absolute;left:0;right:0;bottom:30px;text-align:center;
    font-family:monospace;font-size:12px;color:rgba(241,245,249,0.85);
    text-shadow:0 1px 4px rgba(0,0,0,0.8);pointer-events:none;margin:0;padding:0 20px;
}
.qr-charge-stage{
    position:absolute;inset:0;display:none;
    background:var(--bg);align-items:center;justify-content:center;padding:24px;
}
.qr-charge-stage.active{display:flex}
.qr-charge-card{width:100%;max-width:380px;text-align:center}
.qr-charge-player-name{font-size:20px;font-weight:700;margin:0 0 6px;color:var(--text)}
.qr-charge-player-balance{font-family:monospace;color:var(--dim);font-size:13px;margin:0 0 26px}
.qr-charge-label{
    font-family:monospace;font-size:11px;color:var(--dim);text-transform:uppercase;
    letter-spacing:0.1em;margin:0 0 10px;
}
.qr-amount-display{
    font-family:monospace;font-size:40px;font-weight:700;color:var(--accent);
    background:var(--bg2);border:1px solid var(--border);border-radius:14px;
    padding:16px;margin-bottom:18px;letter-spacing:0.02em;
}
.qr-keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px}
.qr-keypad button{
    background:var(--bg2);color:var(--text);border:1px solid var(--border);
    border-radius:12px;font-family:monospace;font-size:22px;font-weight:600;
    padding:16px 0;cursor:pointer;transition:transform 0.12s ease;
}
.qr-keypad button:active{transform:scale(0.95);background:rgba(249,115,22,0.2)}
.qr-keypad button.qr-keypad-alt{color:var(--dim);font-size:16px}
.qr-charge-actions{display:flex;flex-direction:column;gap:10px}
.qr-charge-actions button{
    border:none;border-radius:10px;font-size:14px;font-weight:600;
    padding:14px 18px;cursor:pointer;transition:transform 0.12s ease,opacity 0.12s ease;
}
.qr-charge-actions button:active{transform:scale(0.97)}
.qr-charge-actions .qr-btn-ghost{background:var(--bg2);color:var(--text);border:1px solid var(--border)}
.qr-charge-actions .qr-btn-accent{background:var(--accent);color:#fff}
`;

// Find the </style> closing tag
const styleCloseIdx = mainLines.findIndex(l => l.trim() === '</style>');
if (styleCloseIdx >= 0) {
    console.log('Found </style> at line', styleCloseIdx + 1);
    mainLines.splice(styleCloseIdx, 0, scannerCSS);
    console.log('Inserted scanner CSS');
} else {
    console.log('WARNING: </style> not found!');
}

// ============================================================
// STEP 4: Add scanner overlay HTML before </body>
// ============================================================
const scannerHTML = `
<!-- QR Scanner Overlay -->
<div class="qr-scanner-overlay" id="qrScannerOverlay">
  <div class="qr-scanner-stage" id="qrScannerStage">
    <video id="qrScanVideo" playsinline autoplay muted></video>
    <div class="qr-scan-frame"></div>
    <div class="qr-scan-laser"></div>
    <button class="qr-scanner-icon-btn qr-scanner-close-btn" onclick="closeQrScanner()">&times;</button>
    <div class="qr-camera-select">
      <button onclick="switchQrCamera('environment')" id="qrCamBackBtn"><span class="cam-ic">📷</span>Задняя</button>
      <button onclick="switchQrCamera('user')" id="qrCamFrontBtn"><span class="cam-ic">🤳</span>Передняя</button>
    </div>
    <p class="qr-scan-status-float" id="qrScanStatus">Наведите камеру на QR-код</p>
  </div>
  <div class="qr-charge-stage" id="qrChargeStage">
    <button class="qr-scanner-icon-btn qr-scanner-close-btn" onclick="closeQrScanner()">&times;</button>
    <div class="qr-charge-card">
      <p class="qr-charge-player-name" id="qrChargeName">Игрок</p>
      <p class="qr-charge-player-balance" id="qrChargeBalance">Баланс: 0</p>
      <p class="qr-charge-label">Сумма списания</p>
      <div class="qr-amount-display" id="qrChargeAmount">0</div>
      <div class="qr-keypad" id="qrKeypad">
        <button type="button" data-k="1">1</button><button type="button" data-k="2">2</button><button type="button" data-k="3">3</button>
        <button type="button" data-k="4">4</button><button type="button" data-k="5">5</button><button type="button" data-k="6">6</button>
        <button type="button" data-k="7">7</button><button type="button" data-k="8">8</button><button type="button" data-k="9">9</button>
        <button type="button" data-k="clear" class="qr-keypad-alt">C</button><button type="button" data-k="0">0</button><button type="button" data-k="back" class="qr-keypad-alt">⌫</button>
      </div>
      <div class="qr-charge-actions">
        <button class="qr-btn-ghost" onclick="resetQrScanner()">Сканировать снова</button>
        <button class="qr-btn-accent" onclick="confirmQrCharge()">Списать</button>
      </div>
    </div>
  </div>
</div>
<canvas id="qrHiddenCanvas" style="display:none"></canvas>
`;

// Find </body> tag
const bodyCloseIdx = mainLines.findIndex(l => l.trim() === '</body>');
if (bodyCloseIdx >= 0) {
    console.log('Found </body> at line', bodyCloseIdx + 1);
    mainLines.splice(bodyCloseIdx, 0, scannerHTML);
    console.log('Inserted scanner HTML');
} else {
    console.log('WARNING: </body> not found!');
}

// ============================================================
// STEP 5: Update scanner tab to add "Open Scanner" button
// ============================================================
const scannerTabOld = `<div id="qrTabScanner" class="hidden">
                <div class="bal-card" style="padding:20px;text-align:center">
                    <div class="stitle" style="margin-bottom:12px">Выберите игрока для списания</div>`;

const scannerTabNew = `<div id="qrTabScanner" class="hidden">
                <div class="bal-card" style="padding:20px;text-align:center">
                    <button class="btn btn-accent btn-full btn-lg" onclick="openQrScanner()" style="margin-bottom:16px"><i data-lucide="camera" style="width:18px;height:18px"></i> 📷 Открыть сканер</button>
                    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px">
                    <div class="stitle" style="margin-bottom:12px">Или выберите игрока вручную</div>`;

const scannerTabEnd = `</div>
            </div>
            <div id="qrTabHistory" class="hidden">`;

// Find the exact text in the file
const fullText = mainLines.join('\n');
let newText = fullText;

// Replace scanner tab content
const oldScannerBlock = `<div id="qrTabScanner" class="hidden">
                <div class="bal-card" style="padding:20px;text-align:center">
                    <div class="stitle" style="margin-bottom:12px">Выберите игрока для списания</div>
                    <div class="search-bar"><input type="text" class="inp" id="qrUserSearch" placeholder="Поиск игрока..." oninput="filterQrUsers()"></div>
                    <div class="ulist" id="qrUserList" style="max-height:200px"></div>
                    <div class="form-g mt-12"><label>Сумма списания (分)</label><input type="number" class="inp inp-lg" id="qrAmount" placeholder="100" min="1" inputmode="numeric"></div>
                    <button class="btn btn-accent btn-full btn-lg" onclick="processQrPayment()"><i data-lucide="check-circle" style="width:18px;height:18px"></i> Списать</button>
                </div>
            </div>`;

const newScannerBlock = `<div id="qrTabScanner" class="hidden">
                <div class="bal-card" style="padding:20px;text-align:center">
                    <button class="btn btn-accent btn-full btn-lg" onclick="openQrScanner()" style="margin-bottom:16px"><i data-lucide="camera" style="width:18px;height:18px"></i> 📷 Открыть сканер</button>
                    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px">
                    <div class="stitle" style="margin-bottom:12px">Или выберите игрока вручную</div>
                    <div class="search-bar"><input type="text" class="inp" id="qrUserSearch" placeholder="Поиск игрока..." oninput="filterQrUsers()"></div>
                    <div class="ulist" id="qrUserList" style="max-height:200px"></div>
                    <div class="form-g mt-12"><label>Сумма списания (分)</label><input type="number" class="inp inp-lg" id="qrAmount" placeholder="100" min="1" inputmode="numeric"></div>
                    <button class="btn btn-accent btn-full btn-lg" onclick="processQrPayment()"><i data-lucide="check-circle" style="width:18px;height:18px"></i> Списать</button>
                    </div>
                </div>
            </div>`;

if (newText.includes(oldScannerBlock)) {
    newText = newText.replace(oldScannerBlock, newScannerBlock);
    console.log('Updated scanner tab HTML');
} else {
    console.log('WARNING: Scanner tab block not found for replacement');
}

// ============================================================
// STEP 6: Add scanner JavaScript before the closing })(); 
// ============================================================
const scannerJS = `
// ==================== QR CAMERA SCANNER ====================
(function(){
    const qrOverlay = document.getElementById('qrScannerOverlay');
    const qrStage = document.getElementById('qrScannerStage');
    const qrCharge = document.getElementById('qrChargeStage');
    const qrVideo = document.getElementById('qrScanVideo');
    const qrStatus = document.getElementById('qrScanStatus');
    const qrCanvas = document.getElementById('qrHiddenCanvas');
    const qrCtx = qrCanvas ? qrCanvas.getContext('2d', {willReadFrequently:true}) : null;

    let qrMediaStream = null;
    let qrScanning = false;
    let qrScanTimeout = null;
    let qrCropPass = false;
    let qrCooldown = false;
    let qrFacingMode = 'environment';
    let qrChargeAmountStr = '0';
    let qrChargeUserId = null;

    function qrShowScanner(){
        if(qrStage)qrStage.classList.add('active');
        if(qrCharge)qrCharge.classList.remove('active');
    }
    function qrShowCharge(){
        if(qrStage)qrStage.classList.remove('active');
        if(qrCharge)qrCharge.classList.add('active');
    }
    function qrUpdateCamUI(){
        const bb=document.getElementById('qrCamBackBtn');
        const fb=document.getElementById('qrCamFrontBtn');
        if(bb)bb.classList.toggle('active',qrFacingMode==='environment');
        if(fb)fb.classList.toggle('active',qrFacingMode==='user');
    }

    async function qrAcquireStream(constraints){
        return navigator.mediaDevices.getUserMedia({video:constraints,audio:false});
    }

    async function qrStartCamera(){
        const ideal={facingMode:{ideal:qrFacingMode},width:{ideal:1280},height:{ideal:720},advanced:[{focusMode:'continuous'}]};
        try{ qrMediaStream=await qrAcquireStream(ideal); }
        catch(e1){
            try{ qrMediaStream=await qrAcquireStream({facingMode:{ideal:qrFacingMode}}); }
            catch(e2){
                try{ qrMediaStream=await qrAcquireStream(true); }
                catch(e3){
                    if(qrStatus)qrStatus.textContent='Камера недоступна: '+e3.message;
                    toast('e','Ошибка','Не удалось получить доступ к камере: '+e3.message);
                    return false;
                }
            }
        }
        if(qrVideo){qrVideo.srcObject=qrMediaStream;await qrVideo.play();}
        return true;
    }

    function qrStopCamera(){
        if(qrMediaStream){qrMediaStream.getTracks().forEach(t=>t.stop());qrMediaStream=null;}
        if(qrVideo)qrVideo.srcObject=null;
    }

    function qrDecodeCanvas(w,h){
        if(!qrCtx||typeof jsQR==='undefined')return null;
        const imageData=qrCtx.getImageData(0,0,w,h);
        const result=jsQR(imageData.data,imageData.width,imageData.height,{inversionAttempts:'attemptBoth'});
        return result&&result.data?result.data:null;
    }

    function qrScanLoop(){
        if(!qrScanning||!qrVideo)return;
        let rawValue=null;
        try{
            if(qrVideo.videoWidth>0){
                const vw=qrVideo.videoWidth,vh=qrVideo.videoHeight;
                qrCropPass=!qrCropPass;
                if(!qrCropPass){
                    const maxDim=720;
                    const scale=Math.min(1,maxDim/Math.max(vw,vh));
                    const w=Math.round(vw*scale),h=Math.round(vh*scale);
                    qrCanvas.width=w;qrCanvas.height=h;
                    qrCtx.drawImage(qrVideo,0,0,w,h);
                    rawValue=qrDecodeCanvas(w,h);
                }else{
                    const cropRatio=0.72;
                    const cw=Math.round(vw*cropRatio),ch=Math.round(vh*cropRatio);
                    const sx=Math.round((vw-cw)/2),sy=Math.round((vh-ch)/2);
                    qrCanvas.width=cw;qrCanvas.height=ch;
                    qrCtx.drawImage(qrVideo,sx,sy,cw,ch,0,0,cw,ch);
                    rawValue=qrDecodeCanvas(cw,ch);
                }
            }
        }catch(e){
            if(qrStatus)qrStatus.textContent='Ошибка: '+e.message;
            qrScanTimeout=setTimeout(qrScanLoop,300);
            return;
        }
        if(rawValue){qrHandleResult(rawValue);return;}
        qrScanTimeout=setTimeout(qrScanLoop,60);
    }

    function qrHandleResult(rawValue){
        if(qrCooldown)return;
        qrScanning=false;
        let data;
        try{ data=JSON.parse(rawValue); }catch(e){ data=null; }
        if(!data||data.type!=='mandarin_pay'||!data.userId){
            toast('e','QR-код','Этот QR-код не относится к банку MANDARIN PRO');
            qrScanning=true;
            qrScanTimeout=setTimeout(qrScanLoop,100);
            return;
        }
        // Look up user
        const user=qrUsers.find(u=>u.id===data.userId);
        if(!user){
            // Try fetching users first
            socket.emit('qr:getUsers');
            toast('e','QR-код','Игрок не найден. Обновите список.');
            qrScanning=true;
            qrScanTimeout=setTimeout(qrScanLoop,100);
            return;
        }
        qrOpenChargeScreen(user);
    }

    function qrOpenChargeScreen(user){
        qrChargeUserId=user.id;
        qrChargeAmountStr='0';
        const nameEl=document.getElementById('qrChargeName');
        const balEl=document.getElementById('qrChargeBalance');
        const amtEl=document.getElementById('qrChargeAmount');
        if(nameEl)nameEl.textContent=user.name;
        if(balEl)balEl.textContent='Баланс: '+user.balance+' 分';
        if(amtEl)amtEl.textContent='0';
        qrShowCharge();
    }

    function qrUpdateAmountDisplay(){
        const el=document.getElementById('qrChargeAmount');
        if(el)el.textContent=parseInt(qrChargeAmountStr,10)||0;
    }

    function qrNextAmountStr(current,key,maxLen){
        maxLen=maxLen||9;
        if(key==='clear')return'0';
        if(key==='back')return current.length>1?current.slice(0,-1):'0';
        if(current==='0')return key;
        if(current.length<maxLen)return current+key;
        return current;
    }

    // Keypad handler
    const qrKeypadEl=document.getElementById('qrKeypad');
    if(qrKeypadEl){
        qrKeypadEl.addEventListener('click',function(e){
            const btn=e.target.closest('button[data-k]');
            if(!btn)return;
            qrChargeAmountStr=qrNextAmountStr(qrChargeAmountStr,btn.getAttribute('data-k'));
            qrUpdateAmountDisplay();
        });
    }

    window.openQrScanner=async function(){
        qrCooldown=false;
        if(qrOverlay)qrOverlay.classList.add('open');
        qrShowScanner();
        qrUpdateCamUI();
        if(qrStatus)qrStatus.textContent='Запрашиваю доступ к камере…';
        const ok=await qrStartCamera();
        if(!ok)return;
        if(qrStatus)qrStatus.textContent='Наведите камеру на QR-код';
        qrScanning=true;
        qrCropPass=false;
        qrScanLoop();
    };

    window.closeQrScanner=function(){
        qrScanning=false;
        qrCooldown=false;
        if(qrScanTimeout)clearTimeout(qrScanTimeout);
        qrStopCamera();
        if(qrOverlay)qrOverlay.classList.remove('open');
        if(qrStage)qrStage.classList.remove('active');
        if(qrCharge)qrCharge.classList.remove('active');
        qrChargeUserId=null;
    };

    window.switchQrCamera=async function(mode){
        if(mode===qrFacingMode)return;
        qrFacingMode=mode;
        qrUpdateCamUI();
        qrScanning=false;
        if(qrScanTimeout)clearTimeout(qrScanTimeout);
        qrStopCamera();
        if(qrStatus)qrStatus.textContent='Переключаю камеру…';
        const bb=document.getElementById('qrCamBackBtn');
        const fb=document.getElementById('qrCamFrontBtn');
        if(bb)bb.disabled=true;if(fb)fb.disabled=true;
        const ok=await qrStartCamera();
        if(bb)bb.disabled=false;if(fb)fb.disabled=false;
        if(!ok){
            qrFacingMode=(mode==='environment')?'user':'environment';
            qrUpdateCamUI();
            return;
        }
        if(qrStatus)qrStatus.textContent='Наведите камеру на QR-код';
        qrScanning=true;
        qrCropPass=false;
        qrScanLoop();
    };

    window.resetQrScanner=function(){
        qrChargeUserId=null;
        qrChargeAmountStr='0';
        qrShowScanner();
        if(qrStatus)qrStatus.textContent='Наведите камеру на QR-код';
        qrScanning=true;
        qrCropPass=false;
        qrScanLoop();
    };

    window.confirmQrCharge=function(){
        if(!qrChargeUserId)return;
        const amount=parseInt(qrChargeAmountStr,10)||0;
        if(!amount||amount<=0){toast('e','Ошибка','Укажите сумму');return;}
        socket.emit('qr:processPayment',{targetUserId:qrChargeUserId,amount:amount});
    };

    // Listen for successful payment to close scanner
    socket.on('qr:paymentSuccess',function(d){
        if(qrOverlay&&qrOverlay.classList.contains('open')){
            toast('s','QR-Оплата','Списано '+d.tx.amount+' 分 у '+d.userName);
            closeQrScanner();
        }
    });
})();
`;

// Find the closing })();  and insert scanner JS before it
const closingPattern = "document.addEventListener('DOMContentLoaded',init);\n})();";
const closingPatternAlt = "document.addEventListener('DOMContentLoaded',init);\r\n})();";

if (newText.includes(closingPattern)) {
    newText = newText.replace(closingPattern, scannerJS + '\n' + closingPattern);
    console.log('Inserted scanner JS before closing IIFE');
} else if (newText.includes(closingPatternAlt)) {
    newText = newText.replace(closingPatternAlt, scannerJS + '\n' + closingPatternAlt);
    console.log('Inserted scanner JS before closing IIFE (CRLF)');
} else {
    console.log('WARNING: Closing pattern not found!');
    // Try alternative
    const altPattern = "document.addEventListener('DOMContentLoaded',init);";
    if (newText.includes(altPattern)) {
        newText = newText.replace(altPattern, scannerJS + '\n' + altPattern);
        console.log('Inserted scanner JS before DOMContentLoaded');
    }
}

// ============================================================
// STEP 7: Fix generateMyQR to clear container first
// ============================================================
// The current code already does box.innerHTML='' and generates QR client-side
// But let's make sure it's robust
const genMyQROld = `window.generateMyQR=function(){
    if(!U)return;
    $('qrMyName').textContent=U.name;
    $('qrMyBalance').textContent=U.balance+' 分';
    // Generate QR directly client-side
    const box=$('qrMyCode');
    if(box&&typeof QRCode!=='undefined'){
        box.innerHTML='';
        const qrData=JSON.stringify({type:'mandarin_pay',userId:U.id,name:U.name,ts:Date.now()});
        new QRCode(box,{text:qrData,width:200,height:200,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
    }
};`;

const genMyQRNew = `window.generateMyQR=function(){
    if(!U)return;
    $('qrMyName').textContent=U.name;
    $('qrMyBalance').textContent=U.balance+' 分';
    const box=$('qrMyCode');
    if(box&&typeof QRCode!=='undefined'){
        box.innerHTML='';
        const qrData=JSON.stringify({type:'mandarin_pay',userId:U.id,name:U.name,ts:Date.now()});
        new QRCode(box,{text:qrData,width:200,height:200,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
    }else if(box){
        box.innerHTML='<div style="padding:20px;color:#666;font-size:13px">QR-библиотека не загружена</div>';
    }
};`;

if (newText.includes(genMyQROld)) {
    newText = newText.replace(genMyQROld, genMyQRNew);
    console.log('Updated generateMyQR with fallback message');
} else {
    console.log('generateMyQR already has correct format or pattern not matched exactly');
}

// Write the result
fs.writeFileSync(mainPath, newText, 'utf-8');
console.log('\nDone! File written to', mainPath);
console.log('New file size:', fs.statSync(mainPath).size, 'bytes');

// Verify basic structure
const result = fs.readFileSync(mainPath, 'utf-8');
const resultLines = result.split('\n');
console.log('New line count:', resultLines.length);
console.log('Has QRCode.js inline:', result.includes('Embedded QRCode.js'));
console.log('Has jsQR inline:', result.includes('Embedded jsQR'));
console.log('Has scanner overlay:', result.includes('qrScannerOverlay'));
console.log('Has scanner CSS:', result.includes('.qr-scanner-overlay'));
console.log('Has scanner JS:', result.includes('openQrScanner'));
console.log('Has open scanner button:', result.includes('Открыть сканер'));
console.log('CDN removed:', !result.includes('cdn.jsdelivr.net/npm/qrcodejs'));
console.log('Has </html>:', result.includes('</html>'));
console.log('Has </body>:', result.includes('</body>'));
