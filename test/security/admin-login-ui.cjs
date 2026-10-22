'use strict';
// Synthetic local browser acceptance: no live accounts, driver approvals or Firebase calls.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assets=path.resolve('../../assets');
const mock=`(()=>{
 window.__allowed=false;window.__calls=[];window.__tokenRefresh=0;
 const rows={driver:{id:'forged',fullName:'Staging Test Driver',status:'pending',phone:'+27820000000',submittedAt:1,
 documentUrls:Object.fromEntries(['selfie','car','identity','licence','address'].map(k=>[k,'https://firebasestorage.googleapis.com/test-'+k]))}};
 const user={uid:'reviewer',email:'reviewer@example.test',getIdToken:async force=>{if(force)window.__tokenRefresh++;return 'synthetic';}};
 let callback;
 const auth={currentUser:null,setPersistence:async()=>{},onAuthStateChanged:fn=>{callback=fn;queueMicrotask(()=>fn(null));return()=>{};},
 signInWithPopup:async provider=>{auth.currentUser=user;await callback(user);return {user};},signOut:async()=>{auth.currentUser=null;await callback(null);}};
 class Provider{setCustomParameters(){}addScope(){}}
 const app={name:'asiye-admin',auth:()=>auth,functions:()=>({httpsCallable:name=>async data=>{
  window.__calls.push([name,data]);if(!window.__allowed)throw {code:'functions/permission-denied'};
  if(name==='adminEnrollmentConsole')return {data:data.action==='session'?{ok:true,uid:user.uid}:{ok:true,data:rows}};
  if(name==='reviewDriverEnrollmentSecure'){if(data.uid!=='driver')throw Error('Database key must own the action');rows.driver.status=data.decision;return {data:{ok:true,status:data.decision}};}
  throw Error('Forbidden API in reviewer mode: '+name);
 }})};
 window.firebase={apps:[{name:'[DEFAULT]',passenger:'unchanged'}],initializeApp:(config,name)=>{if(name!=='asiye-admin')throw Error('Unisolated auth');window.firebase.apps.push(app);return app;},
 auth:{Auth:{Persistence:{SESSION:'session'}},GoogleAuthProvider:Provider,OAuthProvider:Provider}};
})();`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const relative=new URL(req.url,'http://local').pathname;
  const file=path.resolve(assets,'.'+(relative==='/admin/'?'/admin/index.html':relative));
  if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  const mime=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html';
  res.setHeader('Content-Type',mime);res.end(fs.readFileSync(file,'utf8').replaceAll('asiye-80386','asiye-paystack-staging'));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('https://www.gstatic.com/firebasejs/8.10.0/*',route=>route.fulfill({contentType:'application/javascript',body:route.request().url().endsWith('firebase-app.js')?mock:''}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
  await page.waitForSelector('#loginScreen:not([hidden])');await page.click('#adminGoogleLogin');
  await page.waitForFunction(()=>document.getElementById('loginError').textContent.includes('has not been assigned'));
  assert.equal(await page.locator('#shell').isVisible(),false);assert.equal(await page.locator('#signedInAccount').isVisible(),true);
  assert.match(await page.locator('#signedInIdentity').innerText(),/reviewer@example.test/);
  await page.evaluate(()=>{window.__allowed=true;});await page.click('#checkAdminAccess');
  await page.waitForSelector('#shell:not([hidden])');await page.waitForSelector('tbody tr');
  assert.equal(await page.locator('[data-view="payments"]').isVisible(),false);
  assert.equal(await page.locator('[data-view="enrollments"]').isVisible(),true);
  assert.equal(await page.evaluate(()=>firebase.apps[0].passenger),'unchanged');
  await page.locator('tbody tr button').first().click();
  await page.waitForSelector('#drawer[open]');assert.equal(await page.locator('#drawer a[target="_blank"]').count(),5);
  fs.mkdirSync('../../ui-review',{recursive:true});await page.screenshot({path:'../../ui-review/admin-driver-review-desktop.png'});
  await page.getByRole('button',{name:'Approve driver',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Driver approved'));
  assert.ok(await page.evaluate(()=>window.__calls.some(([name,data])=>name==='reviewDriverEnrollmentSecure'&&data.uid==='driver')));
  await page.click('#logout');await page.waitForSelector('#loginScreen:not([hidden])');assert.equal(await page.locator('#drawer').isVisible(),false);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'../../ui-review/admin-login-mobile.png'});
  assert.deepEqual(errors,[]);console.log('PASS isolated admin social login, denied access, refreshed reviewer role, document review, canonical UID approval and logout.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
