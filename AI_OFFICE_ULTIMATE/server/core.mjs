import {randomBytes,createCipheriv,createDecipheriv,scryptSync,timingSafeEqual} from 'node:crypto';
export class Fault extends Error{constructor(message,status=400){super(message);this.status=status}}
export function text(x,n,max=200){if(typeof x!=='string'||!x.trim()||x.length>max)throw new Fault('Некорректное поле: '+n);return x.trim()}
export function encrypt(value,key,aad){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(aad));return Buffer.concat([iv,c.update(value,'utf8'),c.final(),c.getAuthTag()]).toString('base64')}
export function decrypt(value,key,aad){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAAD(Buffer.from(aad));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8')}
export function passwordHash(p){const s=randomBytes(16).toString('hex');return s+':'+scryptSync(p,s,32).toString('hex')}
export function passwordCheck(p,h){const [s,d]=h.split(':');return timingSafeEqual(scryptSync(p,s,32),Buffer.from(d,'hex'))}
// Реальные эндпоинты провайдеров. Не заменять на вымышленные адреса.
export const providers={mimo:'https://api.xiaomimimo.com/v1',groq:'https://api.groq.com/openai/v1',openrouter:'https://openrouter.ai/api/v1',huggingface:'https://router.huggingface.co/v1',github:'https://models.github.ai/inference'};
export const providerMeta={
 mimo:{label:'Xiaomi MiMo (MiMo Code)',keyHint:'Ключ MiMo / XIAOMI_API_KEY',defaultModel:'mimo-v2.5',voice:false,primary:true},
 groq:{label:'Groq',keyHint:'Ключ Groq (gsk_…)',defaultModel:'llama-3.3-70b-versatile',voice:true},
 openrouter:{label:'OpenRouter',keyHint:'Ключ OpenRouter (sk-or-…)',defaultModel:'openai/gpt-4o-mini',voice:false},
 huggingface:{label:'Hugging Face',keyHint:'Токен HF (hf_…)',defaultModel:'Qwen/Qwen2.5-72B-Instruct',voice:false},
 github:{label:'GitHub Models',keyHint:'GitHub PAT (scope: models)',defaultModel:'openai/gpt-4o-mini',voice:false,disabled:'GitHub Models полностью отключён GitHub 30.07.2026 — playground, каталог и inference API больше недоступны. Ключ GitHub нельзя использовать для ИИ-запросов в этой сборке.'},
 demo:{label:'Тестовый адаптер (без ИИ)',keyHint:'',defaultModel:'demo',voice:false,demo:true}
};
export async function complete(c,key,messages,signal,maxTokens=4096){
 if(c.provider==='demo')return {text:'⚠ ТЕСТОВЫЙ АДАПТЕР — это НЕ ответ ИИ.\n\nЗадание принято в работу, но внешняя модель не вызывалась: реальные API-ключи не подключены (или явно выбран тестовый адаптер).\nОтветы тестового адаптера не являются результатом работы модели и не должны использоваться как готовые материалы.\n\nЧтобы получать реальные ответы, откройте «Настройки ИИ → API-подключения» и добавьте ключ Xiaomi MiMo, Groq, OpenRouter или Hugging Face.\n\nТекст задания (для отладки):\n'+String(messages.at(-1)?.content||'').slice(0,800),usage:null,demo:true};
 if(c.provider==='github')throw new Fault((providerMeta.github?.disabled||'GitHub Models недоступен'),502);
 if(!providers[c.provider])throw new Fault('Неизвестный провайдер: '+c.provider);
 const headers={'Content-Type':'application/json','Authorization':'Bearer '+key};
 if(c.provider==='mimo')headers['api-key']=key;
 const body={model:c.model,messages,stream:false,max_tokens:maxTokens};
 if(c.temperature!==null)body.temperature=c.temperature;
 const r=await fetch(providers[c.provider]+'/chat/completions',{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
 if(!r.ok)throw new Fault(c.name+': HTTP '+r.status+' — проверьте ключ, модель и баланс',502);
 const d=await r.json(),answer=d.choices?.[0]?.message?.content;
 if(typeof answer!=='string'||!answer.trim())throw new Fault('Модель не вернула текст',502);
 return {text:answer,usage:d.usage||null}
}
export const instructions={chat:'Ответь на запрос.',word:'Подготовь текст документа с Markdown-заголовками. Файл создаст приложение, не утверждай, что уже создал его.',lesson:'Разработай занятие с целями, этапами, минутами, упражнениями и ключами.',chinese:'Подготовь материал по китайскому языку. Проверяй иероглифы, пиньинь и тоновые знаки.',test:'Верни только JSON: {"title":"...","questions":[{"question":"...","options":["...","...","..."],"answer":0,"explanation":"..."}]}. answer — индекс с нуля. Соблюдай точное число вопросов.',research:'Подготовь обзор по предоставленным материалам. Не выдумывай источники, DOI и цитаты. При отсутствии источников укажи это.',slides:'Верни только JSON: {"title":"...","slides":[{"title":"...","bullets":["..."],"notes":"..."}]}. До 5 коротких пунктов на слайд.',excel:'Верни только JSON: {"title":"...","columns":["..."],"rows":[["...",0]]}. Формула задаётся как {"formula":"SUM(B2:B5)"}. Без внешних ссылок.',code:'Верни только один самодостаточный HTML со встроенными CSS и JS. Без внешней сети. Не утверждай, что выполнил код.'};
export function parseJSON(s){return JSON.parse(s.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))}
export function validate(workflow,s,count){if(!['test','slides','excel'].includes(workflow))return;const d=parseJSON(s);if(workflow==='test'){if(!Array.isArray(d.questions)||!d.questions.length||(count&&d.questions.length!==count))throw Error('Количество вопросов не соответствует заданию');const seen=new Set();for(const q of d.questions){if(typeof q.question!=='string'||!Array.isArray(q.options)||q.options.length<2||!q.options.every(x=>typeof x==='string')||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length)throw Error('Некорректные варианты или ключ');const k=q.question.trim().toLowerCase();if(seen.has(k))throw Error('Есть повторяющиеся вопросы');seen.add(k)}}if(workflow==='slides'&&(!Array.isArray(d.slides)||!d.slides.length||d.slides.some(x=>typeof x.title!=='string'||!Array.isArray(x.bullets))))throw Error('Неверная структура слайдов');if(workflow==='excel'&&(!Array.isArray(d.columns)||!d.columns.length||!Array.isArray(d.rows)))throw Error('Неверная структура таблицы')}
