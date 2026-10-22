'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assets=path.resolve('../../assets');
const mock=`(()=>{
 window.__allowed=false;window.__testCalls=[];
 const trip={id:'test-trip-100',type:'ehailing',status:'payment_required',paymentMethod:'card',paymentStatus:'unpaid',fare:100,createdAt:1,
  driver:{id:'test-driver',name:'Test Driver <script>blocked</script>',approved:true,payoutStatus:'not_configured'}};
 let rows=[trip],callback;const user={uid:'tester',email:'tester@example.test',getIdToken:async()=> 'synthetic'};
 const auth={currentUser:null,setPersistence:async()=>{},onAuthStateChanged:fn=>{callback=fn;queueMicrotask(()=>fn(null));return()=>{};},
  signInWithPopup:async()=>{auth.currentUser=user;await callback(user);return {user};},signOut:async()=>{auth.currentUser=null;await callback(null);}};
 class Provider{setCustomParameters(){}addScope(){}}
 const app={name:'asiye-admin',auth:()=>auth,functions:()=>({httpsCallable:name=>async data=>{
  if(name!=='adminStagingTestConsole')throw Error('Unexpected admin endpoint');window.__testCalls.push(data);
  if(!window.__allowed)throw {code:'functions/permission-denied',message:'Staging trip-test access has not been assigned.'};
  if(data.action==='session')return {data:{ok:true,uid:user.uid,projectId:'asiye-paystack-staging',paystackDomain:'test'}};
  if(data.action==='list')return {data:{ok:true,trips:rows}};
  if(data.action==='linkTestSubaccount'){assertLink(data);trip.driver.payoutStatus='verified';trip.driver.subaccountCode=data.subaccountCode;return {data:{ok:true}};}
  if(data.action==='cancelTrip'){if(data.requestId!=='test-trip-100'||data.confirmation!==data.requestId)throw Error('Wrong trip');rows=[];return {data:{ok:true,needsPaymentReview:true}};}
  throw Error('Unknown action');
 }})};
 function assertLink(data){if(data.driverId!=='test-driver'||data.subaccountCode!=='ACCT_testverified')throw Error('Wrong TEST link');}
 window.firebase={apps:[{name:'[DEFAULT]',passenger:'preserved'}],initializeApp:(config,name)=>{if(name!=='asiye-admin')throw Error('Unisolated auth');firebase.apps.push(app);return app;},
  auth:{Auth:{Persistence:{SESSION:'session'}},GoogleAuthProvider:Provider,OAuthProvider:Provider}};
})();`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://local'),file=path.resolve(assets,'.'+url.pathname);
  if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
  let source=fs.readFileSync(file,'utf8');if(!url.searchParams.has('production'))source=source.replaceAll('asiye-80386','asiye-paystack-staging');
  res.end(source);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://www.gstatic.com/firebasejs/8.10.0/*',route=>route.fulfill({contentType:'application/javascript',body:route.request().url().endsWith('firebase-app.js')?mock:''}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin/testing.html');await page.click('#testGoogle');
  await page.waitForFunction(()=>document.getElementById('testNotice').textContent.includes('has not been assigned'));
  assert.equal(await page.locator('#testWorkspace').isVisible(),false);
  await page.evaluate(()=>{window.__allowed=true;});await page.click('#testCheckAccess');
  await page.getByRole('button',{name:'Review test trip'}).click();
  assert.match(await page.locator('#testDriverStatus').innerText(),/not configured/);assert.equal(await page.locator('#testDriverStatus script').count(),0);
  await page.fill('#testSubaccount','ACCT_testverified');await page.click('#testLinkButton');
  await page.waitForFunction(()=>document.getElementById('testNotice').textContent.includes('subaccount linked'));
  await page.waitForFunction(()=>document.getElementById('testDriverStatus').textContent.includes('verified'));
  fs.mkdirSync('../../ui-review',{recursive:true});await page.screenshot({path:'../../ui-review/staging-trip-tests-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'../../ui-review/staging-trip-tests-mobile.png',fullPage:true});
  await page.fill('#testCancelReason','End this blocked acceptance test');await page.fill('#testCancelConfirm','wrong-trip');await page.click('#testCancelButton');
  assert.match(await page.locator('#testNotice').innerText(),/exact selected trip ID/);
  assert.equal(await page.evaluate(()=>window.__testCalls.filter(call=>call.action==='cancelTrip').length),0);
  await page.fill('#testCancelConfirm','test-trip-100');await page.click('#testCancelButton');
  await page.waitForFunction(()=>document.getElementById('testTrips').textContent.includes('No active test trips'));
  assert.match(await page.locator('#testNotice').innerText(),/refund separately/);
  assert.equal(await page.evaluate(()=>firebase.apps[0].passenger),'preserved');
  await page.click('#testLogout');await page.waitForSelector('#testLogin:not([hidden])');assert.equal(await page.locator('#testWorkspace').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS staging test role, safe TEST linkage, exact-ID cancellation, responsive layout and isolated admin logout.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
