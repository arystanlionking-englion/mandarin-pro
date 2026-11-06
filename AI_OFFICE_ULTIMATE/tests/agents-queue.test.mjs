import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createOffice} from '../server/app.mjs';
test('agents: multi-agent batch, per-agent context, queue capacity, retries and restart recovery',async()=>{
 const root=mkdtempSync(join(tmpdir(),'aio-agents-'));let app;const server=createServer((q,s)=>app.handler(q,s));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let calls=0,retried=0;
 const callModel=async(c)=>{calls++;if(c.model==='flaky'){retried++;if(retried===1){const e=new Error('HTTP 503 — временный сбой');e.retryable=true;throw e}return {text:'После повтора',usage:{}}}if(c.model==='slow'){await new Promise(r=>setTimeout(r,300));return {text:'Долгий ответ',usage:{}}}return {text:'Ответ '+c.name,usage:{}}};
 app=createOffice({root,origin,callModel});let cookie='';
 const request=async(path,body)=>{const r=await fetch(origin+'/ai-office/api/'+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()}};
 const action=async b=>(await request('action',b)).data;
 try{
  await request('login',{password:'test-password-123'});
  const project=await action({action:'project',name:'Проект'});
  const fast=await action({action:'connection',provider:'mimo',name:'Fast',model:'ok',key:'k1'}),flaky=await action({action:'connection',provider:'groq',name:'Flaky',model:'flaky',key:'k2'});
  // многозадачность: два агента получают свои задачи и свои ответы
  const batch=await action({action:'task',requestId:'batch-1',project:project.id,prompt:'Общая задача',connections:[fast.id],agents:['document','education']});
  assert.equal(batch.length,2);assert.deepEqual(batch.map(t=>t.agent).sort(),['document','education']);assert.ok(batch.every(t=>t.id.startsWith('batch-1:')&&t.title==='Общая задача'&&['queued','running'].includes(t.status)));
  // идемпотентность: повторная отправка не создаёт новых задач и не дёргает модели
  const before=calls;const again=await action({action:'task',requestId:'batch-1',project:project.id,prompt:'Общая задача',connections:[fast.id],agents:['document','education']});
  assert.equal(again.length,2);assert.equal(calls,before);
  for(let i=0;i<40;i++){const st=(await request('state')).data.tasks;if(st.length>=2&&st.every(t=>['done','error','needs-review'].includes(t.status)))break;await new Promise(r=>setTimeout(r,25))}
  const st1=(await request('state')).data.tasks;assert.ok(st1.every(t=>t.status==='done'),'все задачи батча завершены');
  // каждый агент сохранил собственный контекст (сообщения с agent)
  const msgs=(await request('state')).data.messages.filter(m=>m.agent);assert.ok(msgs.some(m=>m.agent==='document'));assert.ok(msgs.some(m=>m.agent==='education'));
  // очередь держит больше двух задач одновременно (лимит 2 снят)
  const ids=['q1','q2','q3','q4','q5'].map(r=>action({action:'task',requestId:r,project:project.id,prompt:'Нагрузка',connections:[flaky.id],agent:'research'}));
  const made=await Promise.all(ids);assert.equal(made.length,5);
  // временные ошибки повторяются: модель flaky падает один раз с retryable, затем отвечает
  for(let i=0;i<120;i++){const t=(await request('state')).data.tasks.find(t=>t.id==='q1:research');if(t&&['done','error'].includes(t.status)){assert.equal(t.status,'done');assert.equal(t.answers[0].text,'После повтора');break}await new Promise(r=>setTimeout(r,25))}
  assert.ok(retried>=2,'первая ошибка повторена');
  // test-key: проверка ключа без сохранения
  const check=await action({action:'test-key',provider:'mimo',model:'ok',key:'probe'});assert.equal(check.ok,true);assert.equal(check.sample,'Ответ Xiaomi MiMo (MiMo Code)');
  // восстановление после перезапуска: «running» задача ставится в очередь снова
  const slowT=await action({action:'task',requestId:'slow-1',project:project.id,prompt:'Долгая',connections:[(await action({action:'connection',provider:'mimo',name:'Slow',model:'slow',key:'k3'})).id],agent:'development'});
  await new Promise(r=>setTimeout(r,50));
  app.close();
  app=createOffice({root,origin,callModel,authenticate:()=> 'owner'});
  let revived=null;for(let i=0;i<60;i++){revived=(await request('state')).data.tasks.find(t=>t.id==='slow-1:development');if(revived&&['done','error'].includes(revived.status))break;await new Promise(r=>setTimeout(r,25))}
  assert.ok(revived,'задача найдена после перезапуска');assert.equal(revived.status,'done');assert.equal(revived.output,'Долгий ответ');assert.ok(revived.attempts>=1,'попытка восстановления учтена');
 }finally{await new Promise(r=>server.close(r));try{app.close()}catch{}rmSync(root,{recursive:true,force:true})}
});
