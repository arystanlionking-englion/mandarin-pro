'use strict';
const base=new URL('.',location.href).pathname.replace(/\/$/,''),app=document.querySelector('#app');
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S={projects:[],connections:[],files:[],tasks:[],messages:[],templates:[],settings:{}};
const U={section:'chat',project:'',selected:[],main:'',mode:'single',agent:'document',sel:['document'],prompt:'',editor:'',followup:'',drafts:{},files:[],sourceOnly:false,count:20,minutes:80,level:'HSK 3',maxTokens:4096,task:'',modal:'',mobile:false,office:true,doc:null,index:0,patches:new Map(),undo:[],busy:false,recording:null,mimoChecked:false,asstList:[],asstChats:{},asstSel:[],asstMain:'',asstBusy:false};
const asstApi=async(path,body)=>{const r=await fetch('/api/assistants/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'X-Admin-Token':(()=>{try{return localStorage.getItem('pb_admin_token')||''}catch(e){return ''}})(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw Error(d.error||'Ошибка ассистентов');return d};
const asstById=id=>(U.asstList||[]).find(a=>a.id===id)||null;
const inferWorkflow=t=>{const s=String(t||'').toLowerCase();if(/презентац|слайд|pptx/.test(s))return 'slides';if(/таблиц|excel|xlsx|смет/.test(s))return 'excel';if(/тест|экзамен|контрольн|проверочн/.test(s))return 'test';if(/план заняти|план урок|урок|занятие|методичк|конспект/.test(s))return 'lesson';if(/исследован|обзор литературы|анализ рынка/.test(s))return 'research';if(/код|html|скрипт|программ/.test(s))return 'code';if(/документ|docx|договор|письм|статья|сочинени|эссе|текст на/.test(s))return 'word';return ''};
const workflowAgent=w=>({slides:'document',excel:'document',word:'document',research:'research',lesson:'education',test:'education',code:'development'})[w]||'document';
const AGENTS=[['document','Линь','Документы','文','#e8c37a'],['research','Атлас','Исследования','知','#8fb6e8'],['education','Мэй','Обучение','学','#8fd6b0'],['development','Нео','Разработка','码','#c9a2f2']];
const agentById=id=>AGENTS.find(a=>a[0]===id)||AGENTS[0];
const statusLabel=s=>({queued:'Ожидает',running:'Выполняется',done:'Завершено','needs-review':'Завершено · проверьте',error:'Ошибка',cancelled:'Остановлено',interrupted:'Ошибка',idle:'Готов к работе'}[s]||'Ожидает');
const statusClass=s=>s==='running'?'run':s==='queued'?'wait':(s==='done'||s==='needs-review')?'ok':s==='idle'?'idle':'err';
const agentTasks=id=>S.tasks.filter(t=>t.project===U.project&&t.agent===id);
function agentStatus(id){const ts=agentTasks(id);if(ts.some(t=>t.status==='running'))return 'running';if(ts.some(t=>t.status==='queued'))return 'queued';if(ts.some(t=>['done','needs-review'].includes(t.status)))return 'done';if(ts.some(t=>['error','interrupted','cancelled'].includes(t.status)))return 'error';return 'idle'}
const navSections=[['chat','✦','AI Office'],['word','▤','Word Studio'],['lesson','◷','План занятий'],['chinese','汉','Китайский язык'],['files','▱','Материалы'],['tasks','◴','История заданий']];
const allTitles={chat:'AI Office',word:'Word Studio',lesson:'Планы занятий',chinese:'Китайский язык',test:'Тесты и экзамены',research:'Исследования',slides:'Презентации',excel:'Таблицы',image:'Изображения',code:'Code Builder',files:'Материалы',tasks:'История заданий',settings:'Подключение'};
const B=(action,label,cls='',extra='')=>`<button type="button" data-action="${action}" class="${cls}" ${extra}>${label}</button>`;
const O=(items,selected)=>items.map(([id,name])=>`<option value="${E(id)}" ${String(id)===String(selected)?'selected':''}>${E(name)}</option>`).join('');
const F=(label,name,value,type='text')=>`<label>${label}<input name="${name}" type="${type}" value="${E(value)}"></label>`;
function notice(s,error=false){const t=document.querySelector('#toast');t.textContent=s;t.className='show'+(error?' error':'');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.className='',9000)}
async function api(path,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'X-Admin-Token':(()=>{try{return localStorage.getItem('pb_admin_token')||''}catch(e){return ''}})(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let d;try{d=await r.json()}catch{throw Error('Нет ответа сервера. Запустите программу через START или npm start.')}if(!r.ok){const e=Error(d.error||'Ошибка');e.status=r.status;throw e}return d}const A=b=>api('action',b);
const files=()=>S.files.filter(f=>f.project===U.project);const task=()=>S.tasks.find(t=>t.id===U.task&&t.agent===U.agent)||agentTasks(U.agent)[0]||S.tasks.find(t=>t.project===U.project);
function dl(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
const b64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s)};
async function fileBytes(id){const r=await fetch(base+'/api/file?id='+encodeURIComponent(id),{credentials:'same-origin',headers:{'X-Admin-Token':(()=>{try{return localStorage.getItem('pb_admin_token')||''}catch(e){return ''}})()}});if(!r.ok)throw Error('Файл недоступен');return new Uint8Array(await r.arrayBuffer())}
let worker,seq=0;const jobs=new Map();function docop(method,...args){if(!worker){worker=new Worker(base+'/worker.js');worker.onmessage=({data})=>{const j=jobs.get(data.id);if(j){data.error?j.reject(Error(data.error)):j.resolve(data.result);jobs.delete(data.id)}};worker.onerror=()=>{for(const j of jobs.values())j.reject(Error('Ошибка обработчика документов'));jobs.clear();worker.terminate();worker=null}}return new Promise((resolve,reject)=>{const id=++seq;jobs.set(id,{resolve,reject});worker.postMessage({id,method,args})})}
async function refresh(full=true){Object.assign(S,await api('state'));if(!S.projects.some(p=>p.id===U.project&&!p.archived))U.project=S.projects.find(p=>!p.archived)?.id||'';U.selected=U.selected.filter(id=>S.connections.some(c=>c.id===id));if(!U.selected.length&&S.connections.length)U.selected=[S.connections[0].id];const mimo=S.connections.find(c=>c.provider==='mimo');if(!S.connections.some(c=>c.id===U.main))U.main=(mimo||S.connections[0]||{}).id||'';try{const ad=await asstApi('state');U.asstList=ad.assistants||[];U.asstChats=ad.chats||{};if(U.asstMain&&!U.asstList.some(a=>a.id===U.asstMain))U.asstMain='';if(!U.asstMain)U.asstMain=(S.settings&&S.settings.mainAssistant)||U.asstList[0]?.id||'';if(!U.asstSel.length)U.asstSel=U.asstMain?[U.asstMain]:[];}catch(e){}if(full)render();else{results();streamRender();}}
function saveDraft(){U.drafts[U.agent]={prompt:U.prompt,editor:U.editor,followup:U.followup||''};try{sessionStorage.setItem('aio:'+U.project,JSON.stringify({drafts:U.drafts,agent:U.agent}))}catch{}}
function switchProject(id){saveDraft();U.project=id;U.files=[];U.task='';U.doc=null;U.patches.clear();U.prompt='';U.editor='';U.followup='';U.drafts={};try{const d=JSON.parse(sessionStorage.getItem('aio:'+id)||'{}');if(d.drafts)U.drafts=d.drafts;if(d.agent)U.agent=d.agent;const cur=U.drafts[U.agent];if(cur){U.prompt=cur.prompt||'';U.editor=cur.editor||'';U.followup=cur.followup||''}}catch{}U.mobile=false;render()}
function focusAgent(id){saveDraft();const same=id===U.agent;U.agent=id;U.sel=[id];const d=U.drafts[id];U.prompt=d?.prompt||'';U.editor=d?.editor||'';U.followup=d?.followup||'';if(!same){const ts=agentTasks(id);U.task=ts.length?ts[0].id:''}render()}
function toggleAgent(id){saveDraft();const same=id===U.agent;U.sel=U.sel.includes(id)?U.sel.filter(x=>x!==id):[...U.sel,id];if(!U.sel.length)U.sel=[id];if(U.sel.includes(id)){U.agent=id;const d=U.drafts[id];U.prompt=d?.prompt||'';U.editor=d?.editor||'';U.followup=d?.followup||'';if(!same){const ts=agentTasks(id);U.task=ts.length?ts[0].id:''}}render()}
function setEditor(s){U.editor=s;const el=document.querySelector('#editor');if(el)el.value=s;saveDraft()}
function render(){
  const ta0=U.prompt;
  app.innerHTML=`<div class="shell2">
    <header class="top2">
      <div class="brand2"><b>文</b><span>AI OFFICE</span></div>
      <div class="asst-bar" id="asst-bar">${asstBarHTML()}</div>
      <div class="top2-actions">${B('history','История','button')}${B('settings','⚙ Настройки','button')}</div>
    </header>
    <main class="stream-wrap" id="stream-wrap">
      ${U.section==='settings'?settingsPageHTML():U.section==='history'?historyPageHTML():U.section==='word'&&U.doc?docPageHTML()+workspace():streamHTML()+workspace()}
    </main>
    <footer class="composer2">
      <form id="prompt-form">
        <textarea id="prompt" maxlength="25000" placeholder="Напишите запрос: вопрос ассистенту, документ, презентация, урок, тест…">${E(ta0)}</textarea>
        <div class="composer2-row">
          <div class="composer2-tools">${B('upload','＋ Файлы')}${B('materials','▱ Материалы ('+U.files.length+')')}${B('voice',U.recording?'■ Стоп':'◉ Голос')}${B('voice-queue','Записи')}</div>
          <button class="primary send2" ${U.busy||U.asstBusy?'disabled':''}>${U.busy||U.asstBusy?'Отправка…':'Отправить ↑'}</button>
        </div>
      </form>
    </footer>
  </div>
  <input id="upload" type="file" multiple hidden>
  <dialog id="modal">${modalHTML()}</dialog>`;
  if(U.modal)document.querySelector('#modal').showModal();
  results();streamRender();
  const ta=document.querySelector('#prompt');
  if(ta){ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,220)+'px';}
}
function asstBarHTML(){
  return (U.asstList||[]).map(a=>{
    const sel=U.asstSel.includes(a.id),main=U.asstMain===a.id;
    return `<button type="button" data-asst="${a.id}" class="asst-chip ${sel?'sel':''} ${main?'main':''}" title="${E(a.name)}${a.hasKey?'':' · ключ не задан'}">
      <span class="asst-emoji">${E(a.emoji||'🤖')}</span>
      <span class="asst-name">${E(a.name)}</span>
      ${a.hasKey?'':'<span class="asst-nokey">нет ключа</span>'}
      <span class="asst-open" data-action="asst-open" data-id="${a.id}" title="Открыть ассистента и написать ему">→</span>
    </button>`;
  }).join('')||'<span class="asst-empty">Ассистенты загружаются…</span>';
}
function buildStream(){
  const items=[];
  for(const a of (U.asstList||[])){
    for(const m of (U.asstChats[a.id]||[])){
      items.push({ts:m.ts||0,kind:m.role==='user'?'u':'a',asst:a,text:String(m.content||'')});
    }
  }
  for(const t of (S.tasks||[]).filter(x=>!U.project||x.project===U.project)){
    items.push({ts:t.created||0,kind:'t',task:t});
  }
  items.sort((x,y)=>(x.ts||0)-(y.ts||0));
  return items;
}
function streamItemHTML(it){
  if(it.kind==='u')return `<div class="st-user">${E(it.text)}</div>`;
  if(it.kind==='a')return `<div class="st-asst"><div class="st-asst-head">${E(it.asst.emoji||'🤖')} ${E(it.asst.name)}</div><div class="st-asst-body">${E(it.text)}</div></div>`;
  const t=it.task;
  return `<div class="st-task" data-task="${t.id}">
    <div class="st-task-head"><strong>${E((t.title||t.prompt||'').slice(0,120))}</strong><em class="${statusClass(t.status)}">${statusLabel(t.status)}</em></div>
    <div class="st-task-meta">${E(t.workflow||'')}${t.mode?' · '+E(t.mode):''}${t.completed?' · '+new Date(t.completed).toLocaleString('ru-RU'):''}</div>
    ${t.output?`<pre class="st-task-out">${E(t.output.slice(0,1200))}${t.output.length>1200?'…':''}</pre><div class="st-task-actions">${B('open-task','Открыть результат','button',`data-id="${t.id}"`)}${B('retry','↻ Повторить','button',`data-id="${t.id}"`)}</div>`:`<small class="st-task-stage">${E(t.stage||'')}</small>`}
  </div>`;
}
function streamHTML(){
  const items=buildStream();
  if(!items.length)return '<div class="stream-empty">✦ Выберите ассистента сверху и напишите запрос. Документы, презентации, уроки и тесты создаются через ту же панель ввода.</div>';
  return '<div class="stream" id="stream">'+items.map(streamItemHTML).join('')+'</div>';
}
function streamRender(){
  const el=document.querySelector('#stream');
  if(el){el.innerHTML=buildStream().map(streamItemHTML).join('');el.scrollTop=el.scrollHeight;}
}
function historyPageHTML(){
  const items=buildStream().slice().reverse();
  return `<section class="panel padded"><div class="panel-heading"><h2>История запросов и результатов</h2>${B('settings','⚙ Настройки','button')}</div>
  ${items.map(it=>{
    if(it.kind==='t'){const t=it.task;return `<article class="file-row"><span class="file-symbol">◴</span><div><strong>${E((t.title||t.prompt||'').slice(0,110))}</strong><small>${E(statusLabel(t.status))} · ${new Date(t.created).toLocaleString('ru-RU')} · создано: ${t.output?'результат готов':'—'}${t.answers&&t.answers.length?' · скачиваний доступно: '+t.answers.length:''}</small></div>${t.output?B('open-task','Открыть','button',`data-id="${t.id}"`):''}</article>`}
    return `<article class="file-row"><span class="file-symbol">${it.kind==='u'?'➤':E(it.asst.emoji||'🤖')}</span><div><strong>${E((it.text||'').slice(0,110))}</strong><small>${it.kind==='u'?'Вы':E(it.asst.name)} · ${it.ts?new Date(it.ts).toLocaleString('ru-RU'):''}</small></div></article>`;
  }).join('')||'<div class="empty">История пуста.</div>'}</section>`;
}
function settingsPageHTML(){
  return asstSettingsHTML()+settingsHTML();
}
function asstSettingsHTML(){
  const main=U.asstMain;
  return `<section class="panel padded"><h2>AI-ассистенты</h2>
  <p class="hint">Ключи хранятся только на сервере (маска вместо ключа). Выберите основного ассистента и проверьте подключение.</p>
  <div class="control-grid"><label>Основной ассистент<select id="asst-main">${O((U.asstList||[]).map(a=>[a.id,a.name]),main)}</select></label></div>
  ${(U.asstList||[]).map(a=>`<details class="asst-cfg" ${a.id===main?'open':''}>
    <summary>${E(a.emoji||'🤖')} ${E(a.name)} ${a.hasKey?'· ключ сохранён':'· <b style="color:#c0392b">нет ключа</b>'}</summary>
    <div class="control-grid">
      ${F('Название','asst-name-'+a.id,a.name)}
      <label>Провайдер<select data-asst-field="provider" data-id="${a.id}">${O([['dify','Dify'],['openai','OpenAI-совместимый'],['claude','Claude'],['langflow','Langflow'],['openwebui','Open WebUI']],a.provider)}</select></label>
      ${F('Base URL','asst-base-'+a.id,a.baseUrl)}
      ${F('Модель / ID флоу','asst-model-'+a.id,a.model)}
    </div>
    <div class="control-grid">
      <label>API-ключ (сохранён: ${E(a.keyMask||'не задан')})<input name="asst-key-${a.id}" type="password" autocomplete="off" placeholder="новый ключ — вставьте для замены"></label>
      <label>Температура<input name="asst-temp-${a.id}" type="number" min="0" max="2" step="0.1" value="${E(a.temperature)}"></label>
    </div>
    <label>Системный промпт<textarea name="asst-system-${a.id}">${E(a.system||'')}</textarea></label>
    <div class="form-actions">
      ${B('asst-save','Сохранить','primary',`data-id="${a.id}"`)}
      ${B('asst-test','Проверить связь','button',`data-id="${a.id}"`)}
      ${B('asst-clear-key','Удалить ключ','button',`data-id="${a.id}"`)}
      ${B('asst-clear-chat','Очистить диалог','button',`data-id="${a.id}"`)}
    </div>
    <div class="asst-test-out" id="asst-test-${a.id}"></div>
  </details>`).join('')}
  <div class="hint instr"><b>Ошибка подключения</b> (неверный ключ, недостаточно баланса, недействительный ключ, недоступный адрес) показывается под ассистентом после проверки. Просроченный ключ заменяется полем «API-ключ» и кнопкой «Сохранить» — старый ключ стирается кнопкой «Удалить ключ».</div>
  </section>`;
}
function docPageHTML(){
  return `<section class="panel"><div class="panel-heading"><h2>Документ</h2><div>${B('new-document','Новый','button')}${B('save-doc','Скачать .docx','primary')}</div></div><div id="doc-area"></div></section>`;
}
function wsStatusHTML(){const t=task();if(!t)return '<div class="ws-status bar-idle"><b>Ожидает</b><span>Опишите задачу в панели ниже</span></div>';const st=statusClass(t.status);return `<div class="ws-status bar-${st}"><b>${statusLabel(t.status)}</b><span>${E(t.stage||'')}</span><small>${new Date(t.created).toLocaleString('ru-RU')}</small>${['running','queued'].includes(t.status)?B('cancel','■ Остановить','button',`data-id="${t.id}"`):B('retry','↻ Повторить','button',`data-id="${t.id}"`)}</div>`}
function wsResultsHTML(){const t=task();if(!t)return '<div class="ready-note">✦ Готов к задаче</div>';const answers=(t.answers||[]).map((a,i)=>`<article><div class="answer-title"><strong>${E(a.name)}</strong>${a.status==='done'?B('use-answer','В редактор','',`data-task="${t.id}" data-index="${i}"`):`<em>${a.status==='error'?'Ошибка':'Выполняется…'}</em>`}</div><pre>${E(a.text||a.error||'')}</pre></article>`).join('');return `${answers?`<div class="answers">${answers}</div>`:''}${t.output?`<details ${['team','synthesis'].includes(t.mode)?'open':''}><summary>Итоговый ответ</summary><pre>${E(t.output)}</pre></details><div class="export-bar"><span>Итог:</span>${B('use-result','Взять ответ в редактор','button')}</div>`:''}${t.validation&&t.validation!=='ok'?`<div class="warning">${E(t.validation)}</div>`:''}`}
function wsHistoryHTML(){const ts=agentTasks(U.agent);return `<span>История заданий</span>${ts.slice(0,6).map(x=>B('open-task',E((x.title||x.prompt||'').slice(0,70))+' · '+statusLabel(x.status),'file-choice',`data-id="${x.id}"`)).join('')||'<small>Пока нет заданий</small>'}`}
function workspace(){
  const t=task();
  const wf=(t&&t.workflow)||U.section||'chat';
  let extra='';
  if(wf==='slides')extra=B('slides-export','Скачать PPTX','button');
  else if(wf==='excel')extra=B('sheet-export','Скачать XLSX','button');
  else if(wf==='test')extra=B('check-test','Проверить','button')+B('student-test','Тест ученика','button')+B('teacher-test','Тест с ключами','button');
  else if(wf==='code')extra=B('preview','Предпросмотр','button')+B('html-export','Скачать HTML','button');
  return `<section class="panel workspace">
    <div class="panel-heading"><h2>Панель результатов</h2><small>${E(statusLabel(t?t.status:'idle'))}</small></div>
    <div id="ws-status">${wsStatusHTML()}</div>
    <div id="ws-results">${wsResultsHTML()}</div>
    <div class="ws-edit">
      <textarea id="editor" class="document-editor" placeholder="Здесь появляется результат. Редактируйте и сохраняйте готовую работу.">${E(U.editor)}</textarea>
      <div class="ws-followup"><input id="followup" value="${E(U.followup||'')}" placeholder="Дополнительная инструкция: исправь, дополни, перепиши…">${B('followup','Доработать ↑','primary')}</div>
      <div class="export-bar"><span>Готовый файл:</span>${B('use-result','Взять ответ','button')}${B('word-export','Word .docx','button')}${B('print','PDF / печать','button')}${B('txt','TXT','button')}${B('save-editor','Сохранить в проект','primary')}${B('speak','▶ Озвучить','button')}${B('stop-speak','■','button')}${extra}</div>
      <div class="ws-history" id="ws-history"></div>
    </div>
  </section>`;
}
function sectionHTML(){return streamHTML()+workspace()}
function filesHTML(){return `<section class="panel"><div class="panel-heading"><div><h2>Материалы проекта</h2><small>Оригиналы и версии · до 25 МБ на файл · DOCX, PDF, TXT</small></div>${B('upload','＋ Загрузить','primary')}</div>${files().map(f=>`<article class="file-row"><span class="file-symbol">${f.name.endsWith('.docx')?'W':/\.pdf$/i.test(f.name)?'P':'▤'}</span><div><strong>${E(f.name)}</strong><small>${(f.size/1024).toFixed(1)} КБ · ${f.originalId?'новая версия':'оригинал'} · ${f.hasText?'текст извлечён':'без извлечённого текста'}</small></div><div>${B('download','↓','',`data-id="${f.id}"`)}${B('extract','Текст','',`data-id="${f.id}"`)}${/\.(docx|pptx|xlsx)$/i.test(f.name)?B('open-doc','Редактировать','',`data-id="${f.id}"`):''}${B('rename-file','✎','',`data-id="${f.id}"`)}</div></article>`).join('')||'<div class="empty"><span>▱</span><p>Загрузите первые материалы.</p></div>'}</section>`}
function settingsHTML(){const P=S.providerInfo||{};return `<section class="panel padded"><h2>Подключение · API-подключения</h2><p>Ключи вводятся один раз и хранятся зашифрованно на сервере (AES-256-GCM). В браузер возвращаются только маска и статус. Сохранённый ключ не считается рабочим — проверяйте его кнопкой «Проверить».</p><div class="connection-row" style="opacity:.85"><div><strong>⚠ Тестовый адаптер (без ИИ)</strong><small>demo · временная заглушка, пока нет ключей. Ответы не от модели и явно помечаются.</small></div></div>${S.connections.map(c=>{const m=P[c.provider]||{};return `<div class="connection-row"><div><strong>${E(c.name)}</strong><small>${E(c.provider)} · ${E(c.model)} · ${E(c.mask)}${m.disabled?' · <b style="color:#c0392b">недоступно</b>':''}</small></div>${B('check-connection','Проверить подключение','button',`data-id="${c.id}"`)}${B('replace-key','Заменить ключ','button',`data-id="${c.id}"`)}${B('delete-connection','Удалить','',`data-id="${c.id}"`)}</div>`}).join('')}<form id="connection-form"><div class="control-grid"><label>Провайдер<select name="provider">${O([['mimo','Xiaomi MiMo (MiMo Code) — основной'],['groq','Groq'],['openrouter','OpenRouter'],['huggingface','Hugging Face'],['github','GitHub Models — сервис отключён (30.07.2026)']],'mimo')}</select></label>${F('Название (необязательно)','name','')}${F('Model ID (необязательно — возьмём модель по умолчанию)','model','')}</div><div class="control-grid">${F('API-ключ','key','','password')}${F('Температура (необязательно)','temperature','','number')}</div><div class="form-actions">${B('test-key','Проверить ключ','button')}<button class="primary">Добавить подключение</button></div></form><div class="hint instr"><b>Инструкция для администратора</b><ol><li>Получите API-ключ у выбранного провайдера (ссылки ниже).</li><li>Вставьте ключ в поле «API-ключ».</li><li>При необходимости укажите Model ID (иначе возьмём модель по умолчанию).</li><li>Нажмите «Проверить ключ» — убедитесь, что тестовый запрос успешен.</li><li>Нажмите «Добавить подключение».</li><li>Кнопкой «Проверить подключение» убедитесь, что связь работает.</li></ol><b>Где получать ключи и какие модели поддерживаются</b><ul><li><b>Xiaomi MiMo (MiMo Code)</b> — основная модель по умолчанию: <code>api.xiaomimimo.com</code>, модель <code>mimo-v2.5</code>. Ключ — в личном кабинете Xiaomi MiMo.</li><li><b>Groq</b> — <code>console.groq.com</code>, ключ <code>gsk_…</code>, модель <code>llama-3.3-70b-versatile</code>. Голос — только через Groq.</li><li><b>OpenRouter</b> — <code>openrouter.ai</code>, ключ <code>sk-or-…</code>, модель <code>openai/gpt-4o-mini</code> (или любая из каталога OpenRouter).</li><li><b>Hugging Face</b> — <code>huggingface.co</code>, токен <code>hf_…</code>, модель <code>Qwen/Qwen2.5-72B-Instruct</code>.</li><li><b>GitHub Models</b> — отключён GitHub 30.07.2026, ключ для ИИ не используется.</li></ul>Причина каждой ошибки показывается конкретно: неверный ключ, модель недоступна, недостаточно средств, лимит запросов, формат запроса, ошибка сервера. Ошибка одного провайдера не блокирует остальные.</div></section><section class="panel padded"><h2>Оформление и инструкции</h2><form id="settings-form"><div class="control-grid">${F('Шрифт Word','font',S.settings.font||'Arial')}${F('Размер, пт','size',S.settings.size||12,'number')}${F('Поля, мм','margin',S.settings.margin||20,'number')}${F('Язык ответа','language',S.settings.language||'русский')}${F('Колонтитул','header',S.settings.header||'')}</div><label>Системные инструкции<textarea name="system">${E(S.settings.system||'')}</textarea></label><button class="primary">Сохранить</button></form></section><section class="panel padded"><h2>Резервная копия</h2><p>Экспорт ниже содержит историю и настройки без ключей и бинарных файлов.</p>${B('backup','Скачать историю и настройки','button')}</section>`}
function results(){const a=document.querySelector('#ws-status');if(a)a.innerHTML=wsStatusHTML();const b=document.querySelector('#ws-results');if(b)b.innerHTML=wsResultsHTML();const c=document.querySelector('#ws-history');if(c)c.innerHTML=wsHistoryHTML()}
function taskList(){const el=document.querySelector('#task-list');if(el)el.innerHTML=S.tasks.filter(t=>t.project===U.project).map(t=>{const [,an,,sym]=agentById(t.agent);return `<article class="file-row"><span class="file-symbol">${sym}</span><div><strong>${E(t.title||t.prompt.slice(0,120))}</strong><small>${E(an)} · ${statusLabel(t.status)} · ${new Date(t.created).toLocaleString('ru-RU')}</small>${t.output?`<small class="task-preview">${E(t.output.slice(0,120))}…</small>`:''}</div>${B('open-task','Открыть','button',`data-id="${t.id}"`)}</article>`}).join('')||'<div class="empty">Пока нет заданий</div>'}
function renderDoc(){const el=document.querySelector('#doc-area');if(!el||!U.doc)return;const b=U.doc.info.blocks[U.index];el.innerHTML=`<div class="doc-info"><strong>${E(U.doc.file.name)}</strong><small>Текстовый предпросмотр. Точный макет смотрите в офисном приложении.</small></div><div class="warning">Сложные элементы защищены. Изменение объёма текста может сдвинуть страницы.</div><div class="doc-layout"><div class="doc-outline">${U.doc.info.blocks.map((b,i)=>`<button data-block="${i}" class="${i===U.index?'active':''}"><small>${i+1} ${b.editable?'':'🔒'}</small><span>${E(b.text.slice(0,100)||'Пустой элемент')}</span>${U.patches.has(i)?'●':''}</button>`).join('')}</div><div class="doc-edit"><label>Исходный текст<textarea readonly>${E(b.text)}</textarea></label><label>Предлагаемое изменение<textarea id="paragraph" ${b.editable?'':'disabled'}>${E(U.patches.get(U.index)?.after??b.text)}</textarea></label><small>${E(b.reason||'Остальные элементы документа сохраняются.')}</small><div class="export-bar">${B('accept','Принять','primary')}${B('reject','Отклонить','button')}${B('ai-paragraph','Исправить с ИИ','button',b.editable?'':'disabled')}${B('paste-paragraph','Вставить ответ ИИ','button',b.editable?'':'disabled')}</div></div></div><div class="export-bar">${B('undo','↶ Отменить','button')}${B('original','Оригинал','button')}${B('save-doc','Скачать исправленный файл','primary')}${B('save-version','Новая версия в проекте','button')}<span>Правок: ${U.patches.size}</span></div>`}
function modalHTML(){const close=B('close','×','modal-close','aria-label="Закрыть"');if(!U.modal)return '';if(U.modal==='materials')return close+'<h2>Материалы задания</h2><p>Выбирайте файлы с извлечённым текстом.</p>'+files().map(f=>`<label class="check"><input type="checkbox" data-file="${f.id}" ${U.files.includes(f.id)?'checked':''} ${f.hasText?'':'disabled'}>${E(f.name)} ${f.hasText?'':'— текст не извлечён'}</label>`).join('')+B('close','Готово','primary');if(U.modal==='open-word')return close+'<h2>Открыть документ</h2>'+files().filter(f=>/\.(docx|pptx|xlsx)$/i.test(f.name)).map(f=>B('open-doc',E(f.name),'file-choice',`data-id="${f.id}"`)).join('')+B('upload','＋ Загрузить','primary');if(U.modal==='archives')return close+'<h2>Архив</h2>'+S.projects.filter(p=>p.archived).map(p=>`<div class="connection-row"><strong>${E(p.name)}</strong>${B('restore','Восстановить','button',`data-id="${p.id}"`)}</div>`).join('');if(U.modal==='templates')return close+'<h2>Шаблоны запросов</h2>'+S.templates.map(t=>B('template-use',E(t.name),'file-choice',`data-id="${t.id}"`)).join('')+`<form id="template-form">${F('Название','name','')}<label>Запрос<textarea name="prompt">${E(U.prompt)}</textarea></label><button class="primary">Сохранить шаблон</button></form>`;if(U.modal==='voice')return close+`<h2>Голосовой ввод</h2><p>Запись сохраняется на устройстве. После распознавания проверьте текст.</p><label>Подключение<select id="voice-connection">${O(S.connections.filter(c=>c.provider==='groq').map(c=>[c.id,c.name]),'')}</select></label>${F('Модель распознавания','voice-model','whisper-large-v3')}${B('record','◉ Начать запись','primary')}`;if(U.modal==='voice-queue')return close+'<h2>Сохранённые записи</h2><div id="voice-list">Загрузка…</div>';if(U.modal==='replace-key')return close+`<h2>Заменить API-ключ</h2><p>Старый ключ будет удалён с сервера. Название и провайдер сохранятся; модель можно обновить.</p><form id="replace-key-form">${F('Новый API-ключ','key','','password')}${F('Модель (оставьте пустым, чтобы не менять)','model','')}<button class="primary">Сохранить</button></form>`;return close+`<h2>${U.modal==='new-project'?'Новый проект':'Название проекта'}</h2><form id="project-form">${F('Название','name',U.modal==='rename-project'?S.projects.find(p=>p.id===U.project)?.name:'')}<button class="primary">Сохранить</button></form>`}
async function modal(name){U.modal=name;render();if(name==='voice-queue')await voiceList()}
async function saveBlob(blob,name,originalId=null){if(!U.project)throw Error('Выберите проект');return A({action:'upload',project:U.project,name,mime:blob.type,data:b64(new Uint8Array(await blob.arrayBuffer())),originalId})}
async function upload(list){if(!U.project)throw Error('Создайте проект');for(const f of list){if(f.size>25*1024*1024)throw Error(f.name+': максимум 25 МБ');notice('Загружаю '+f.name+'…');const bytes=new Uint8Array(await f.arrayBuffer());let extracted='';try{extracted=await docop('extract',bytes,f.name)}catch{}await A({action:'upload',project:U.project,name:f.name,mime:f.type,data:b64(bytes),extracted})}await refresh();notice('Файлы сохранены. Выберите их в материалах задания.')}
async function run(){if(U.busy||U.asstBusy)return;const pel=document.querySelector('#prompt');const text=String((pel&&pel.value)||U.prompt||'').trim();if(!text)throw Error('Введите запрос');U.prompt='';const wf=inferWorkflow(text);
if(wf){
  if(!U.project){try{const p=await A({action:'project',name:'Мои документы'});if(p&&p.id)U.project=p.id}catch(e){}}
  if(!U.project)throw Error('Не удалось создать проект для документов');
  U.busy=true;render();
  try{
    let prompt=text;
    if(wf==='lesson')prompt+='\nУровень: '+U.level+'. Занятие: '+U.minutes+' минут.';
    if(wf==='test')prompt+='\nРовно '+U.count+' вопросов.';
    const conns=U.selected.length?U.selected:['demo'];
    if(conns[0]==='demo')notice('Тестовый адаптер: ответ будет не от ИИ.');
    const agents=[workflowAgent(wf)];
    U.agent=agents[0];U.sel=agents.slice();U.section=wf;
    const res=await A({action:'task',requestId:crypto.randomUUID(),project:U.project,prompt,connections:conns,main:U.main||conns[0],mode:U.mode,workflow:wf,agents,files:U.files,sourceOnly:U.sourceOnly,count:wf==='test'?U.count:null,maxTokens:U.maxTokens});
    const list=Array.isArray(res)?res:[res];
    const mine=list.find(x=>x.agent===U.agent)||list[0];
    if(mine)U.task=mine.id;
    await refresh();
  }finally{U.busy=false;render()}
  return;
}
  const ids=(U.asstSel.length?U.asstSel:[U.asstMain]).filter(Boolean);
  if(!ids.length)throw Error('Выберите ассистента вверху');
  U.asstBusy=true;render();
  try{
    await Promise.all(ids.map(async id=>{try{await asstApi('chat',{id,message:text})}catch(e){notice((asstById(id)&&asstById(id).name||'Ассистент')+': '+e.message,true)}}));
    try{const ad=await asstApi('state');U.asstList=ad.assistants||U.asstList;U.asstChats=ad.chats||U.asstChats}catch(e){}
  }finally{U.asstBusy=false;render()}
}
function json(s){return JSON.parse(s.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))}
function testData(){const d=json(U.editor);if(!Array.isArray(d.questions)||d.questions.length!==Number(U.count))throw Error('Требуется '+U.count+' вопросов');const seen=new Set();for(const q of d.questions){if(typeof q.question!=='string'||!Array.isArray(q.options)||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length)throw Error('Неверный вопрос или ключ');const k=q.question.trim().toLowerCase();if(seen.has(k))throw Error('Есть повтор вопроса');seen.add(k)}return d}
async function act(name,el){switch(name){case'menu':U.mobile=!U.mobile;render();break;case'settings':U.section='settings';render();break;case'new-project':case'rename-project':case'archives':case'templates':case'materials':case'open-word':await modal(name);break;case'close':U.modal='';render();break;case'toggle-office':U.office=!U.office;render();break;case'agents-all':saveDraft();U.sel=AGENTS.map(a=>a[0]);render();break;case'agents-one':U.sel=[U.agent];render();break;case'agent-toggle':toggleAgent(el.dataset.agent);break;case'refresh':await refresh();break;case'upload':document.querySelector('#upload').click();break;
case'copy-project':if(!U.project)throw Error('Выберите проект');{const p=await A({action:name,id:U.project});await refresh();switchProject(p.id)}break;
case'archive':if(!U.project)throw Error('Выберите проект');if(confirm('Переместить проект в архив?')){await A({action:'project',...S.projects.find(p=>p.id===U.project),archived:true});U.project='';await refresh()}break;
case'restore':await A({action:'project',...S.projects.find(p=>p.id===el.dataset.id),archived:false});U.modal='';await refresh();break;
case'download':dl(new Blob([await fileBytes(el.dataset.id)]),S.files.find(f=>f.id===el.dataset.id).name);break;
case'rename-file':{const f=S.files.find(f=>f.id===el.dataset.id),name=prompt('Имя файла',f.name);if(name){await A({action:'rename-file',id:f.id,name});await refresh()}}break;
case'extract':{const f=S.files.find(f=>f.id===el.dataset.id);notice('Извлекаю текст…');const extracted=await docop('extract',await fileBytes(f.id),f.name);await A({action:'file-text',id:f.id,extracted});await refresh();notice('Текст извлечён')}break;
case'open-doc':{const f=S.files.find(f=>f.id===el.dataset.id);notice('Открываю документ…');const bytes=await fileBytes(f.id),info=await docop('inspect',bytes,f.name);U.doc={file:f,bytes,info};U.index=Math.max(0,info.blocks.findIndex(b=>b.editable));U.patches=new Map();U.undo=[];U.section='word';U.modal='';render()}break;
case'new-document':if(U.patches.size&&!confirm('Закрыть документ с несохранёнными правками?'))break;U.doc=null;U.patches.clear();setEditor('');render();break;
case'accept':U.undo.push(new Map(U.patches));U.patches.set(U.index,{index:U.index,before:U.doc.info.blocks[U.index].text,after:document.querySelector('#paragraph').value});renderDoc();break;
case'reject':U.undo.push(new Map(U.patches));U.patches.delete(U.index);renderDoc();break;
case'undo':if(U.undo.length){U.patches=U.undo.pop();renderDoc()}break;
case'ai-paragraph':U.prompt='Исправь ошибки и ясность абзаца. Верни только исправленный текст без комментариев:\n\n'+U.doc.info.blocks[U.index].text;render();await run();break;
case'paste-paragraph':if(!task()?.output)throw Error('Сначала получите ответ ИИ');document.querySelector('#paragraph').value=task().output;notice('Проверьте текст и нажмите «Принять».');break;
case'original':dl(new Blob([U.doc.bytes]),U.doc.file.name);break;
case'save-doc':case'save-version':{const bytes=await docop('patch',U.doc.bytes,U.doc.file.name,[...U.patches.values()]),blob=new Blob([bytes],{type:U.doc.file.mime||'application/octet-stream'}),filename=U.doc.file.name.replace(/(\.[^.]+)$/,' — исправлено$1');if(name==='save-version'){await saveBlob(blob,filename,U.doc.file.originalId||U.doc.file.id);await refresh();notice('Новая версия сохранена')}else dl(blob,filename)}break;
case'use-result':if(!task()?.output)throw Error('Ответ ещё не готов');setEditor(task().output);break;
case'use-answer':setEditor(S.tasks.find(t=>t.id===el.dataset.task).answers[Number(el.dataset.index)].text);break;
case'followup':{const ins=(document.querySelector('#followup')?.value||U.followup||'').trim();if(!ins)throw Error('Введите дополнительную инструкцию');U.followup='';const ctx=U.editor||task()?.output||'';U.sel=[U.agent];U.prompt=ctx?'Доработай результат по инструкции. Инструкция: '+ins+'\n\nТекущий результат:\n'+ctx:ins;render();await run()}break;
case'word-export':case'save-editor':if(!U.editor.trim())throw Error('Редактор пуст');{notice('Формирую Word…');const blob=await docop('word',U.editor,S.settings);if(name==='word-export')dl(blob,'AI_Office_Document.docx');else{await saveBlob(blob,'Документ_'+Date.now()+'.docx');await refresh();notice('Документ сохранён')}}break;
case'txt':dl(new Blob([U.editor],{type:'text/plain;charset=utf-8'}),'AI_Office.txt');break;
case'print':if(!U.editor.trim())throw Error('Редактор пуст');{const win=window.open('','_blank');if(!win)throw Error('Разрешите окно печати');win.document.write('<!doctype html><html lang="ru"><meta charset="utf-8"><title>AI Office</title><style>@page{size:A4;margin:20mm}body{font:12pt Arial;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:20pt}</style><body>'+E(U.editor)+'</body></html>');win.document.close();win.focus();setTimeout(()=>win.print(),300)}break;
case'slides-export':dl(await docop('slides',json(U.editor)),'AI_Office_Presentation.pptx');break;
case'sheet-export':dl(await docop('sheet',json(U.editor)),'AI_Office_Table.xlsx');break;
case'check-test':testData();notice('Количество, ключи и точные повторы проверены. Содержание проверяет преподаватель.');break;
case'student-test':case'teacher-test':{const d=testData();let text='# '+(d.title||'Тест')+'\n\n'+d.questions.map((q,i)=>`${i+1}. ${q.question}\n${q.options.map((v,j)=>String.fromCharCode(65+j)+'. '+v).join('\n')}`).join('\n\n');if(name==='teacher-test')text+='\n\n# Ключи\n'+d.questions.map((q,i)=>`${i+1}. ${String.fromCharCode(65+q.answer)} — ${q.explanation||''}`).join('\n');dl(await docop('word',text,S.settings),name==='teacher-test'?'Тест_с_ключами.docx':'Тест_ученика.docx')}break;
case'preview':{const html=U.editor.replace(/^```(?:html)?\s*/,'').replace(/\s*```$/,'');U.modal='preview';render();const d=document.querySelector('#modal');d.innerHTML=B('close','×','modal-close')+'<h2>Изолированный предпросмотр</h2><p>Доступ к сети, секретам и родительскому приложению запрещён.</p><iframe sandbox="allow-scripts" title="Предпросмотр HTML"></iframe>';d.querySelector('iframe').srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">'+html}break;
case'html-export':dl(new Blob([U.editor.replace(/^```(?:html)?\s*/,'').replace(/\s*```$/,'')],{type:'text/html'}),'AI_Office_App.html');break;
case'speak':if(!window.speechSynthesis)throw Error('Озвучивание недоступно');speechSynthesis.cancel();{const speech=new SpeechSynthesisUtterance(U.editor||task()?.output||'');speech.lang=/[\u4e00-\u9fff]/.test(speech.text)?'zh-CN':'ru-RU';speechSynthesis.speak(speech)}break;
case'stop-speak':window.speechSynthesis?.cancel();break;
case'cancel':await A({action:'cancel',id:el.dataset.id});await refresh(false);break;
case'retry':{const t=S.tasks.find(t=>t.id===el.dataset.id);U.prompt=t.prompt;U.section=navSections.some(s=>s[0]===t.workflow)?t.workflow:'chat';U.agent=t.agent||'document';U.sel=[U.agent];U.selected=t.connections;U.mode=t.mode;U.files=t.files;render();notice('Задание восстановлено. Нажмите «Выполнить», чтобы отправить снова.')}break;
case'open-task':{const t=S.tasks.find(x=>x.id===el.dataset.id);saveDraft();U.task=t.id;U.agent=t.agent||'document';U.sel=[U.agent];U.section=navSections.some(s=>s[0]===t.workflow)?t.workflow:'chat';if(t.output){U.editor=t.output;U.drafts[U.agent]={...(U.drafts[U.agent]||{}),editor:t.output}}render()}break;
case'template-use':U.prompt=S.templates.find(t=>t.id===el.dataset.id).prompt;U.modal='';render();break;
case'delete-connection':if(confirm('Удалить подключение?')){await A({action:name,id:el.dataset.id});await refresh()}break;
case'check-connection':{const r=await A({action:'check-connection',id:el.dataset.id});notice(r.ok?((r.demo?'Тестовый адаптер: это не ответ ИИ. ':'Ключ работает. Ответ модели: ')+(r.sample||'')):('Проверка не пройдена: '+(r.error||'ошибка')),!r.ok)}break;
case'test-key':{const f=document.querySelector('#connection-form');const b=Object.fromEntries(new FormData(f));if(!String(b.key||'').trim())throw Error('Введите API-ключ для проверки');notice('Проверяю ключ…');const r=await A({action:'test-key',provider:b.provider,model:b.model,key:b.key,temperature:b.temperature});notice(r.ok?('Ключ работает. Ответ модели: '+(r.sample||'')):('Проверка не пройдена: '+(r.error||'ошибка')),!r.ok)}break;
case'replace-key':U.replaceId=el.dataset.id;U.modal='replace-key';render();break;
case'backup':dl(new Blob([JSON.stringify(await A({action:'backup'}),null,2)],{type:'application/json'}),'AI_Office_Backup.json');break;
case'voice':if(U.recording){U.recording.stop();U.recording=null;render()}else await modal('voice');break;
case'record':await record();break;
case'voice-queue':await modal(name);break;
case'voice-delete':await voiceDB('delete',el.dataset.id);await voiceList();break;
case'voice-retry':{const r=(await voiceDB('list')).find(r=>r.id===el.dataset.id);await voiceDB('put',{...r,attempts:0,next:0});await drainVoice();await voiceList()}break;
case'voice-use':{const r=(await voiceDB('list')).find(r=>r.id===el.dataset.id);U.prompt=r.text;U.modal='';render()}break;
case'logout':await A({action:'logout'});sessionStorage.clear();await boot();break;
case'history':U.section=U.section==='history'?'chat':'history';render();break;
case'asst-open':U.asstSel=[el.dataset.id];U.asstMain=el.dataset.id;U.section='chat';render();{const ta=document.querySelector('#prompt');if(ta)ta.focus()}break;
case'asst-save':{const id=el.dataset.id;const g=n=>document.querySelector(`[name="${n}"]`);const b={id,name:g('asst-name-'+id)?.value,provider:document.querySelector(`[data-asst-field="provider"][data-id="${id}"]`)?.value,baseUrl:g('asst-base-'+id)?.value,model:g('asst-model-'+id)?.value,temperature:g('asst-temp-'+id)?.value,system:g('asst-system-'+id)?.value};const k=g('asst-key-'+id)?.value;if(k&&k.trim())b.apiKey=k.trim();await asstApi('config',b);const ad=await asstApi('state');U.asstList=ad.assistants||U.asstList;U.asstChats=ad.chats||U.asstChats;notice('Настройки ассистента сохранены. Ключ хранится только на сервере.');render()}break;
case'asst-test':{const id=el.dataset.id;const out=document.querySelector('#asst-test-'+id);if(out)out.textContent='Проверяю подключение…';try{const r=await asstApi('test',{id});if(out)out.textContent='✅ Связь ОК. Ответ модели: '+String(r.reply||'').slice(0,160)}catch(e){if(out)out.textContent='❌ '+e.message+' — проверьте ключ, баланс и адрес API; замените ключ выше.'}}break;
case'asst-clear-key':if(confirm('Удалить сохранённый API-ключ у этого ассистента?')){await asstApi('config',{id:el.dataset.id,clearKey:true});const ad=await asstApi('state');U.asstList=ad.assistants||U.asstList;notice('Ключ удалён с сервера');render()}break;
case'asst-clear-chat':if(confirm('Очистить диалог с этим ассистентом?')){await asstApi('clear',{id:el.dataset.id});const ad=await asstApi('state');U.asstChats=ad.chats||{};render()}break;
}}
function voiceDB(op,value){return new Promise((resolve,reject)=>{const r=indexedDB.open('aio-voice',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'id'});r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('records',op==='list'?'readonly':'readwrite'),s=tx.objectStore('records'),q=op==='list'?s.getAll():op==='put'?s.put(value):s.delete(value);let result;q.onsuccess=()=>result=q.result;tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>reject(tx.error)}})}
async function record(){if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Запись требует поддерживаемого браузера и HTTPS/localhost');const connection=document.querySelector('#voice-connection').value,model=document.querySelector('[name="voice-model"]').value;if(!connection)throw Error('Добавьте подключение Groq для распознавания голоса');const stream=await navigator.mediaDevices.getUserMedia({audio:true}),mime=['audio/webm;codecs=opus','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));let rec;try{rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)}catch(e){stream.getTracks().forEach(t=>t.stop());throw e}const chunks=[];let size=0;rec.ondataavailable=e=>{chunks.push(e.data);size+=e.data.size;if(size>24*1024*1024&&rec.state==='recording')rec.stop()};rec.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());U.recording=null;try{await voiceDB('put',{id:crypto.randomUUID(),blob:new Blob(chunks,{type:rec.mimeType}),connection,model,created:Date.now(),attempts:0,next:0,status:'Сохранено'});notice('Запись сохранена. Распознаю…');await drainVoice();render()}catch(e){notice('Не удалось сохранить запись: '+e.message,true)}};rec.start(1000);U.recording=rec;U.modal='';render();notice('Запись идёт. Нажмите «Остановить запись».')}
let voiceBusy=false;async function drainVoice(){if(voiceBusy||!navigator.onLine)return;voiceBusy=true;try{for(const r of await voiceDB('list')){if(r.text||r.attempts>=3||r.next>Date.now())continue;await voiceDB('put',{...r,status:'Распознаётся',attempts:r.attempts+1,next:Date.now()+120000});try{const d=await A({action:'transcribe',requestId:r.id,connection:r.connection,model:r.model,mime:r.blob.type,data:b64(new Uint8Array(await r.blob.arrayBuffer()))});await voiceDB('put',{...r,text:d.text,status:'Готово',attempts:r.attempts+1});notice('Речь распознана. Откройте «Записи», чтобы вставить текст.')}catch(e){await voiceDB('put',{...r,status:e.message,attempts:e.status&&e.status<500&&![409,429].includes(e.status)?3:r.attempts+1,next:Date.now()+30000*2**r.attempts})}}}finally{voiceBusy=false;if(U.modal==='voice-queue')await voiceList()}}
async function voiceList(){const el=document.querySelector('#voice-list');if(!el)return;const rows=await voiceDB('list');el.innerHTML=rows.map(r=>`<div class="voice-row"><strong>${new Date(r.created).toLocaleString('ru-RU')}</strong><small>${E(r.status)} · ${(r.blob.size/1024).toFixed(0)} КБ</small>${r.text?'<p>'+E(r.text)+'</p>'+B('voice-use','Вставить текст','button',`data-id="${r.id}"`):B('voice-retry','Распознать','button',`data-id="${r.id}"`)}${B('voice-delete','Удалить','',`data-id="${r.id}"`)}</div>`).join('')||'<p>Сохранённых записей нет.</p>'}
app.addEventListener('click',e=>{const ao=e.target.closest('span[data-action="asst-open"]');if(ao){e.preventDefault();e.stopPropagation();void act('asst-open',{dataset:{id:ao.dataset.id}}).catch(err=>notice(err.message,true));return}const tg=e.target.closest('span[data-action="agent-toggle"]');if(tg){e.preventDefault();e.stopPropagation();void act('agent-toggle',{dataset:{agent:tg.dataset.agent}}).catch(err=>notice(err.message,true));return}const el=e.target.closest('button');if(!el)return;if(el.dataset.asst){const id=el.dataset.asst;U.asstSel=U.asstSel.includes(id)?U.asstSel.filter(x=>x!==id):[...U.asstSel,id];if(!U.asstSel.length)U.asstSel=[id];render();return}if(el.dataset.section){U.section=el.dataset.section;U.mobile=false;render();return}if(el.dataset.project){switchProject(el.dataset.project);return}if(el.dataset.agent){focusAgent(el.dataset.agent);return}if(el.dataset.block!==undefined){U.index=Number(el.dataset.block);renderDoc();return}if(el.dataset.action){e.preventDefault();void act(el.dataset.action,el).catch(e=>notice(e.message,true))}});
app.addEventListener('input',e=>{const el=e.target;if(el.id==='prompt'){U.prompt=el.value;saveDraft()}if(el.id==='editor'){U.editor=el.value;saveDraft()}if(el.id==='followup'){U.followup=el.value;saveDraft()}if(el.id==='search')document.querySelectorAll('[data-project]').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(el.value.toLowerCase()));if(['count','minutes'].includes(el.id))U[el.id]=Number(el.value)});
app.addEventListener('change',e=>{const el=e.target;if(el.dataset.connection){if(el.checked&&U.selected.length>=4){el.checked=false;notice('Максимум 4 модели');return}U.selected=el.checked?[...U.selected,el.dataset.connection]:U.selected.filter(x=>x!==el.dataset.connection)}if(el.dataset.file)U.files=el.checked?[...U.files,el.dataset.file]:U.files.filter(x=>x!==el.dataset.file);if(el.id==='mode')U.mode=el.value;if(el.id==='main-model')U.main=el.value;if(el.id==='tokens')U.maxTokens=Number(el.value);if(el.id==='level')U.level=el.value;if(el.id==='source-only')U.sourceOnly=el.checked;if(el.id==='asst-main'){U.asstMain=el.value;U.asstSel=[el.value];A({action:'settings',...(S.settings||{}),mainAssistant:el.value}).then(()=>notice('Основной ассистент сохранён')).catch(e=>notice(e.message,true));render();return}if(el.id==='upload')void upload([...el.files]).catch(e=>notice(e.message,true))});
app.addEventListener('cancel',()=>U.modal='',true);
app.addEventListener('keydown',e=>{if(e.target.id==='prompt'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(min-width:800px)').matches){e.preventDefault();void run().catch(e=>notice(e.message,true))}});
app.addEventListener('submit',e=>{e.preventDefault();const f=e.target,b=Object.fromEntries(new FormData(f));void(async()=>{if(f.id==='prompt-form')return run();if(f.id==='login-form'){await api('login',b);return boot()}if(f.id==='project-form'){const p=await A({action:'project',name:b.name,...(U.modal==='rename-project'?{id:U.project}:{})});U.modal='';await refresh();switchProject(p.id)}if(f.id==='replace-key-form'){await A({action:'update-connection',id:U.replaceId,key:b.key,...(b.model&&String(b.model).trim()?{model:String(b.model).trim()}:{})});U.modal='';await refresh();notice('Ключ заменён')}if(f.id==='connection-form'){await A({action:'connection',...b});f.reset();await refresh();notice('Подключение сохранено')}if(f.id==='settings-form'){await A({action:'settings',...b});await refresh();notice('Настройки сохранены')}if(f.id==='template-form'){await A({action:'template',...b});await refresh();notice('Шаблон сохранён')}if(f.id==='image-form'){U.busy=true;f.querySelector('button').disabled=true;notice('Создаётся изображение…');try{await A({action:'image',project:U.project,...b});await refresh();notice('Изображение сохранено в файлах')}finally{U.busy=false;render()}}})().catch(e=>notice(e.message,true))});
let timer;async function boot(){clearInterval(timer);try{const a=await api('auth');if(location.hash==='#settings')U.section='settings';if(!a.user){app.innerHTML=`<div class="login"><div class="brand"><b>文</b><div>AI OFFICE <strong>ULTIMATE</strong></div></div><h1>${a.setup?'Ваш личный AI-офис':'Добро пожаловать'}</h1><p>${a.integrated?'Войдите через учётную запись Mandarin Pro.':a.setup?'Задайте пароль владельца — не менее 10 символов.':'Введите пароль владельца.'}</p>${a.integrated?'':`<form id="login-form"><label>Пароль<input name="password" type="password" required minlength="${a.setup?10:1}" autocomplete="${a.setup?'new-password':'current-password'}"></label><button class="primary">${a.setup?'Создать кабинет':'Войти'}</button></form>`}<small>API-ключи добавляются после входа.</small></div>`;return}await refresh();if(!U.mimoChecked){U.mimoChecked=true;const mimo=S.connections.find(c=>c.provider==='mimo');if(!mimo)notice('Xiaomi MiMo Code не подключён — добавьте ключ в разделе «Подключение», чтобы использовать основную модель.');else{try{const r=await A({action:'check-connection',id:mimo.id});if(r.ok)notice('Xiaomi MiMo Code на связи'+(r.sample?': '+r.sample:''));else notice('Xiaomi MiMo Code недоступен: '+(r.error||'ошибка')+'. Выберите другого провайдера в «Параметрах моделей».',true)}catch(e){notice('Xiaomi MiMo Code: '+e.message,true)}}}timer=setInterval(async()=>{try{await refresh(false);await drainVoice()}catch(e){if(e.status===401)await boot()}},4000)}catch(e){app.innerHTML='<div class="login"><h1>AI Office Ultimate</h1><p>'+E(e.message)+'</p><p>Запустите START_WINDOWS.bat, START_MAC_LINUX.sh или npm start, затем откройте http://127.0.0.1:8787/ai-office/</p></div>'}}
function kbFix(){const vv=window.visualViewport;if(!vv)return;const kb=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);document.documentElement.style.setProperty('--kb',kb+'px')}
if(window.visualViewport){window.visualViewport.addEventListener('resize',kbFix);window.visualViewport.addEventListener('scroll',kbFix);kbFix()}
window.addEventListener('online',()=>void drainVoice().catch(e=>notice(e.message,true)));window.addEventListener('message',e=>{if(e.data&&e.data.aioSection){U.section=e.data.aioSection;render()}});void boot();


