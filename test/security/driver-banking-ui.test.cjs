'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..');
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
async function setup({status='not_configured',postStatus='pending_paystack_verification',fail,profile='owned-driver'}={}){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'assets/driver-v2/payout.html'),'utf8'),{url:'https://asiye.test/driver-v2/payout.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 const w=dom.window,calls=[];let current=status,failNow=fail;
 w.localStorage.setItem('driverId','another-signed-out-driver');
 const user={uid:'current-auth',getIdToken:async()=> 'authenticated-token'};
 w.firebase={auth:()=>({currentUser:user})};
 w.AsiyeEnrollment={resolveDriverProfile:async actor=>{assert.equal(actor,user);return profile?{id:profile}:null;}};
 w.AsiyeSession={logout:async()=>{}};
 w.fetch=async(url,options)=>{
  const u=new URL(url);calls.push({u,options});
  assert.equal(u.searchParams.get('driverId'),'owned-driver');
  assert.equal(options.headers.Authorization,'Bearer authenticated-token');
  if(failNow){const f=failNow;failNow=null;return {ok:false,status:403,json:async()=>({error:f})};}
  if(options.method==='POST'){current=postStatus;return {ok:true,status:200,json:async()=>({ok:true,status:current})};}
  if(u.searchParams.get('action')==='banks')return {ok:true,json:async()=>({ok:true,banks:[{code:'250655',name:'Example Bank'}]})};
  return {ok:true,json:async()=>({ok:true,status:current,bankName:'Example Bank',accountLast4:current==='not_configured'?'':'7890'})};
 };
 w.eval(fs.readFileSync(path.join(root,'assets/driver-v2/js/payout.js'),'utf8'));await flush();
 return {dom,w,calls,setStatus:value=>current=value,failNext:value=>failNow=value};
}
function fill(w){
 for(const [id,value]of Object.entries({payoutBank:'250655',payoutName:'Example Driver',payoutNumber:'1234567890',payoutDoc:'8001015009087'}))w.document.getElementById(id).value=value;
}
test('banking resolves the signed-in profile instead of reusing another account ID',async()=>{
 const h=await setup();try{
  assert.equal(h.calls.length,2);assert.equal(h.w.document.getElementById('payoutForm').hidden,false);
  assert.equal(h.w.document.getElementById('payoutBadge').textContent,'Action needed');
  assert.equal(h.w.document.getElementById('payoutBank').options[1].text,'Example Bank');
 }finally{h.dom.window.close();}
});
test('submission stays pending until server verification; refresh shows masked verified bank after reload',async()=>{
 const h=await setup();try{
  fill(h.w);h.w.document.getElementById('payoutForm').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();
  const post=h.calls.find(c=>c.options.method==='POST');assert.ok(post);
  assert.equal(JSON.parse(post.options.body).driverId,'owned-driver');
  assert.equal(JSON.parse(post.options.body).documentNumber,'8001015009087');
  assert.equal(h.w.document.getElementById('payoutBadge').textContent,'Pending verification');
  assert.equal(h.w.document.getElementById('payoutForm').hidden,true);
  assert.equal(h.w.document.getElementById('payoutNumber').value,'');
  assert.equal(h.w.document.getElementById('payoutDoc').value,'');
  h.setStatus('verified');h.w.document.getElementById('checkPayoutStatus').click();await flush();
  assert.equal(h.w.document.getElementById('payoutBadge').textContent,'Verified');
  assert.match(h.w.document.getElementById('payoutAccount').textContent,/ending 7890/);
  assert.equal(h.w.document.body.textContent.includes('1234567890'),false);
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);
 }finally{h.dom.window.close();}
 const reopened=await setup({status:'verified'});try{
  assert.equal(reopened.w.document.getElementById('payoutBadge').textContent,'Verified');
  assert.equal(reopened.w.document.getElementById('payoutForm').hidden,true);
  assert.equal(reopened.calls.length,1);
 }finally{reopened.dom.window.close();}
});
test('pending and manual-review applications never offer a duplicate bank submission',async()=>{
 for(const status of ['pending_paystack_verification','provisioning','manual_review']){
  const h=await setup({status});try{
   assert.equal(h.w.document.getElementById('payoutForm').hidden,true);
   h.w.document.getElementById('payoutForm').dispatchEvent(new h.w.Event('submit',{cancelable:true}));await flush();
   assert.equal(h.calls.some(c=>c.options.method==='POST'),false);
   assert.notEqual(h.w.document.getElementById('payoutBadge').textContent,'Verified');
  }finally{h.dom.window.close();}
 }
});
test('a failed status read reports the error and supports retry without a false success',async()=>{
 const h=await setup({fail:'Driver and vehicle must be approved.'});try{
  assert.match(h.w.document.getElementById('payoutHeading').textContent,/approval required/);
  assert.equal(h.w.document.getElementById('payoutForm').hidden,true);
  assert.equal(h.w.document.getElementById('checkPayoutStatus').disabled,false);
  h.w.document.getElementById('checkPayoutStatus').click();await flush();
  assert.equal(h.w.document.getElementById('payoutForm').hidden,false);
 }finally{h.dom.window.close();}
});
test('a missing owned profile cannot send banking requests using stale storage',async()=>{
 const h=await setup({profile:null});try{
  assert.equal(h.calls.length,0);assert.equal(h.w.document.getElementById('payoutForm').hidden,true);
  assert.match(h.w.document.getElementById('payoutStatus').textContent,/approved driver account/);
 }finally{h.dom.window.close();}
});
test('the driver dashboard exposes banking before a Card booking is created',()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(root,'assets/driver-v2/index.html'),'utf8'),{url:'https://asiye.test/driver-v2/index.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 try{
  const w=dom.window;w.document.addEventListener=()=>{};
  w.ASIYE_DRIVER={state:{driver:{name:'Driver',payoutStatus:'pending_paystack_verification'},availability:{}}};
  w.eval(fs.readFileSync(path.join(root,'assets/driver-v2/js/app.js'),'utf8'));
  w.ASIYE_DRIVER.ui.updateTopStatus=()=>{};w.ASIYE_DRIVER.ui.renderDashboard();
  assert.ok(w.document.querySelector('[data-driver-page="banking"]'));
  assert.match(w.document.querySelector('.driver-banking-card').textContent,/Verification pending|verification pending/);
  assert.equal(w.document.querySelector('.driver-banking-card').getAttribute('href'),'./payout.html');
 }finally{dom.window.close();}
});
