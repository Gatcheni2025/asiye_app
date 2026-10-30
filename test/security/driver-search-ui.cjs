'use strict';
// Synthetic screen review only. No live location, accounts, bookings or payments.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  fs.mkdirSync('../../ui-review',{recursive:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main><p style="padding:28px;color:#436650;font-size:12px">ASIYE GO · SCREEN REVIEW</p><section class="bottom-sheet open"><div class="sheet-handle"></div><div id="sheetContent"></div></section></main></body></html>');
  await page.addStyleTag({path:'../../assets/passenger-v2/css/app.css'});
  await page.addStyleTag({content:'body{background:linear-gradient(145deg,#e6f0e7,#d9e7dd)}'});
  await page.evaluate(()=>{
   window.__cancelled=0;
   window.ASIYE={state:{booking:{fare:86,paymentMethod:'cash'}},ui:{escape:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))},
    booking:{cancelCurrentRide:async()=>{window.__cancelled++;}}};
  });
  await page.addScriptTag({path:'../../assets/passenger-v2/js/ride-controller.js'});
  await page.evaluate(()=>{
   ASIYE.ride.scheduleGoDriverSearchRetry=()=>{};
   window.__renderSearch=found=>{
    const request={requestId:'screen-review',type:'ehailing',status:'searching',negotiationEnabled:true,fareStatus:'passenger_offer',passengerOffer:86,
     pickupAddress:'Durban Station, Durban',destination:'Gateway Theatre of Shopping, Umhlanga',driverFoundCount:found?1:0,driverSearchStatus:found?'driver_found_waiting_acceptance':'searching_for_driver',nearestDriverDistanceKm:found?1.2:null};
    ASIYE.ride.renderGoSearching(request);ASIYE.ride.renderTripSummary(request,'searching');
   };window.__renderSearch(false);
  });
  assert.equal(await page.locator('.go-search-ring').first().evaluate(n=>getComputedStyle(n).animationName),'go-radar');
  for(const width of [320,390,580]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(width===390){
    const cancel=await page.locator('[data-trip-cancel]').boundingBox();
    assert.ok(cancel.y+cancel.height<=844,'Fare and cancellation fit the initial mobile screen');
    await page.screenshot({path:'../../ui-review/go-searching-mobile.png'});
   }
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__renderSearch(true));
  assert.equal(await page.locator('h2').innerText(),'Driver found');
  await page.screenshot({path:'../../ui-review/go-driver-found-mobile.png'});
  assert.equal(await page.locator('[data-trip-cancel]').count(),1);
  await page.locator('[data-trip-cancel]').click();assert.equal(await page.evaluate(()=>window.__cancelled),1);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.__renderSearch(false));
  assert.equal(await page.locator('.go-search-ring').first().evaluate(n=>getComputedStyle(n).animationName),'none');
  const driver=await browser.newPage({viewport:{width:390,height:844}});driver.on('pageerror',e=>errors.push(e.message));
  await driver.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Driver dashboard</h1></body></html>');
  await driver.addStyleTag({path:'../../assets/driver-v2/css/app.css'});
  await driver.addStyleTag({path:'../../assets/member-pages.css'});
  await driver.evaluate(()=>{
   window.__saved=[];window.firebase={auth:()=>({currentUser:null})};
   window.ASIYE_DRIVER={state:{driverId:'driver',driver:{}},ui:{toast(){}}};
   window.AsiyeSafetyContact={getMembers:async()=>[],saveMember:async data=>window.__saved.push(data)};
  });
  await driver.addScriptTag({path:'../../assets/member-pages.js'});
  await driver.evaluate(()=>AsiyePages.open('safety',{setup:true}));
  assert.equal(await driver.locator('[data-family-later]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(238, 244, 236)');
  await driver.screenshot({path:'../../ui-review/driver-optional-contact-mobile.png'});
  await driver.locator('[data-family-later]').click();await driver.waitForFunction(()=>!document.querySelector('dialog'));
  await driver.evaluate(()=>AsiyePages.open('safety',{setup:true}));
  await driver.locator('[name=name]').fill('Trusted Person');await driver.locator('[name=relationship]').selectOption({label:'Sibling'});
  await driver.locator('[name=phone]').fill('0821234567');await driver.getByRole('button',{name:'Save and continue',exact:true}).click();
  await driver.waitForFunction(()=>!document.querySelector('dialog'));
  assert.equal(await driver.evaluate(()=>window.__saved.length),1);
  assert.deepEqual(errors,[]);
  console.log('PASS animated search, real found-state rendering, responsive route/offer/cancel, reduced motion and optional contact save/later.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
