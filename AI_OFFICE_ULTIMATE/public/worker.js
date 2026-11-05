importScripts('vendor/jszip.js','documents.js');
self.onmessage=async({data})=>{try{if(data.method==='word'&&!self.docx)importScripts('vendor/docx.js');if(data.method==='slides'&&!self.PptxGenJS)importScripts('vendor/pptx.js');const result=await OfficeDocuments[data.method](...data.args);postMessage({id:data.id,result})}catch(e){postMessage({id:data.id,error:e.message})}};
