# Интеграция и API

Модуль не предполагает знание текущей инфраструктуры Mandarin Pro. Локальный entry point — server/index.mjs. createOffice возвращает handler(req,res), db, close(). root должен содержать public; .data создаётся в root. base по умолчанию /ai-office, без завершающего слеша; origin без пути и слеша. Клиент открывайте по /ai-office/.

Пример для Node HTTP (адаптировать под реальную авторизацию):

```js
import {createOffice} from './server/app.mjs';
const office=createOffice({
 root:'/srv/private/ai-office',
 origin:'https://YOUR_MANDARIN_DOMAIN',
 base:'/ai-office',
 authenticate:async(req)=>{
   const user=await existingVerifiedSession(req);
   return user?.permissions?.includes('ai-office:owner') ? user.id : null;
 }
});
// Существующий router передаёт /ai-office/* в office.handler,
// не удаляя prefix из req.url. Это пример контракта, не готовый код вашей системы.
```

Встроенная проверка Host требует origin.host, mutation требует Origin===origin. При reverse proxy настройте Host явно; не доверяйте произвольному X-Forwarded-Host. Авторизация во внешнем модуле не отменяет проверку Origin. Для Node Express нельзя передать уже прочитанный JSON stream без адаптации body(): подключите handler до JSON middleware либо адаптируйте парсер.

## HTTP

Все пути ниже начинаются с /ai-office/api. JSON, Cookie credentials same-origin. Ошибка `{error:string}` и 4xx/5xx. Ключи и upstream body не включаются в ошибки.

| Метод | Путь | Назначение |
|---|---|---|
| GET | /auth | user/setup/integrated |
| POST | /login | {password}; локальная установка пароля или вход |
| GET | /state | projects, connections (маски), files, tasks, messages, templates, settings |
| GET | /file?id=UUID | Скачивание файла текущего владельца |
| POST | /action | JSON с action и параметрами |

Действия:
- project: name, optional id, archived.
- copy-project: id.
- connection: name, provider, model, key, optional temperature. Новый ID; для замены удалите старое подключение через delete-connection {id}.
- settings: system,language,font,size,margin,header.
- template: name,prompt.
- upload: project,name,mime,data (base64),extracted,optional originalId. До 25 МБ бинарных данных.
- file-text: id,extracted; rename-file: id,name.
- task: requestId,project,prompt,connections (1–4 ID),main,mode(single/compare/synthesis/team),workflow,files,count,maxTokens,sourceOnly,web. Возвращает задачу с HTTP202, завершение через /state. requestId уникален на намеренную отправку, повтор не запускает повторную оплату.
- cancel: id. Остановка не гарантирует отмену списания у провайдера.
- transcribe: requestId,connection,model,mime,data(base64).
- image: project,connection,model,prompt; поддерживается OpenAI base64 image response.
- backup: экспорт метаданных и истории; logout: выход из локальной сессии.

Схемы генераторов: слайды `{slides:[{title,bullets:[string],notes}]}`; таблица `{columns:[string],rows:[[string|number|{formula:string}]]}`; тест `{title,questions:[{question,options:[string],answer:0,explanation}]}`. answer — индекс с нуля.

Клиент хранит только временные черновики в sessionStorage и аудио в IndexedDB. История хранится на сервере. Каждая SQL-операция scoped по owner. В standalone авторизация рассчитана на одного владельца; authenticate позволяет интегрировать владельцев существующей системы. Не используйте клиентские роли как механизм доступа.

## Протоколы провайдеров

MiMo/Groq/OpenAI/Gemini используют chat/completions; Anthropic — messages. Модели вводятся пользователем. Проверяйте их текущую поддержку полей токенов/temperature; серверный адаптер core.mjs — единственное место для изменения провайдерского протокола.

Официальные справочники:
- https://mimo.mi.com/docs/en-US/api/chat/openai-api
- https://console.groq.com/docs/openai
- https://platform.openai.com/docs/api-reference/chat
- https://docs.anthropic.com/en/api/messages
- https://ai.google.dev/gemini-api/docs/openai
- https://api-dashboard.search.brave.com/app/documentation/web-search

Перед размещением в интернете нужны тесты в вашей среде, лимиты файлового хранилища и жизненного цикла истории, централизованные секреты, резервные копии, мониторинг и перенос сессий в существующую систему. Встроенный standalone сервер слушает только loopback.
