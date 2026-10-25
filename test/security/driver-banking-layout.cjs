'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../../assets'),out=path.resolve(__dirname,'../../banking-layout');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
  res.setHeader('Content-Type',type[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [320,360,390]){
   const page=await browser.newPage({viewport:{width,height:844},deviceScaleFactor:1});
   let status='not_configured',posts=0;
   await page.addInitScript(()=>{
    window.firebase={auth:()=>({currentUser:{uid:'layout-driver',getIdToken:async()=> 'UI_SIMULATION_ONLY'}})};
    window.AsiyeEnrollment={resolveDriverProfile:async()=>({id:'layout-driver'})};
    window.AsiyeSession={logout:async()=>{}};
   });
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='us-central1-asiye-80386.cloudfunctions.net'){
     assert.equal(u.pathname,'/configureDriverCardPayout');
     const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
     if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
     let data;
     if(route.request().method()==='POST'){posts++;status='pending_paystack_verification';data={ok:true,status};}
     else data=u.searchParams.get('action')==='banks'?{ok:true,banks:[{name:'Example Bank',code:'250655'}]}:
      {ok:true,status,bankName:'Example Bank',accountLast4:status==='not_configured'?'':'7890'};
     await route.fulfill({json:data,headers});return;
    }
    if(u.hostname!=='127.0.0.1'||/\/(?:firebase|enrollment-gate|presence|session)\.js$/.test(u.pathname)){
     await route.fulfill({contentType:'application/javascript',body:''});return;
    }
    await route.continue();
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/driver-v2/payout.html');
   await page.locator('#payoutForm').waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('#verifyPayoutBank').evaluate(el=>el.getBoundingClientRect().height>=44),true);
   await page.screenshot({path:path.join(out,'banking-'+width+'-setup.png'),fullPage:true});
   await page.locator('#payoutBank').selectOption('250655');
   await page.locator('#payoutName').fill('Example Driver');
   await page.locator('#payoutNumber').fill('1234567890');
   await page.locator('#payoutDoc').fill('8001015009087');
   await page.locator('#verifyPayoutBank').click();
   await page.getByRole('heading',{name:'Your bank verification is in progress'}).waitFor();
   assert.equal(posts,1);assert.equal(await page.locator('#payoutNumber').inputValue(),'');
   await page.screenshot({path:path.join(out,'banking-'+width+'-pending.png'),fullPage:true});
   status='verified';await page.locator('#checkPayoutStatus').click();
   await page.getByRole('heading',{name:'Your bank is verified'}).waitFor();
   assert.match(await page.locator('#payoutAccount').textContent(),/ending 7890/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.join(out,'banking-'+width+'-verified.png'),fullPage:true});
   await page.close();
  }
  console.log('PASS banking: 320/360/390 px, no horizontal overflow, accessible submit target, one submission, pending and verified masked status.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
