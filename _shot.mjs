import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1180,height:820,deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8119/',{waitUntil:'load'}); await new Promise(r=>setTimeout(r,1400));
console.log('page errors:', errs.length?errs.join(' | '):'none');
await (await p.$('#s03')).screenshot({path:'/tmp/eff.png'});
// idle note
const note = await p.evaluate(()=>{const k=[...document.querySelectorAll('#s02 .kpi')].find(x=>x.textContent.includes('ralentí')); return k? k.querySelector('.k-val').textContent.trim()+' | '+k.querySelector('.k-note').textContent : 'NF';});
console.log('idle:', note);
await b.close();
