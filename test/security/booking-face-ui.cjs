'use strict';
// Browser-only camera/Save/cancel acceptance with synthetic video, no accounts or bookings.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button id="book">Book Go</button></body></html>');
  await page.addStyleTag({path:'../../assets/passenger-v2/css/booking-face.css'});
  await page.addScriptTag({path:'../../assets/passenger-v2/js/onboarding.js'});
  await page.evaluate(()=>{
   window.saved=0;window.resumed=0;window.streams=[];
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=480;
    const c=canvas.getContext('2d');c.fillStyle='#80b391';c.fillRect(0,0,480,480);c.fillStyle='#214935';c.fillRect(120,80,240,320);
    const stream=canvas.captureStream(10);window.streams.push(stream);return stream;
   }}});
   window.startBooking=()=>window.AsiyePassengerOnboarding.open({name:'Mandla',save:async photo=>{
    if(!photo.startsWith('data:image/jpeg;base64,'))throw Error('No captured photo');
    window.saved++;if(window.saved===1)throw Error('Connection lost. Tap Save again.');return 'https://test.invalid/saved.jpg';
   }}).then(()=>window.resumed++,e=>{window.cancelled=e.code;});
   document.getElementById('book').onclick=window.startBooking;
  });
  await page.click('#book');
  assert.equal(await page.locator('[data-face-save]').isDisabled(),true);
  await page.click('[data-face-open]');await page.waitForSelector('[data-face-shutter]:not([hidden]):not([disabled])');
  assert.equal(await page.locator('[data-face-save]').isDisabled(),true);
  await page.click('[data-face-shutter]');
  assert.equal(await page.locator('[data-face-save]').isEnabled(),true);
  assert.equal(await page.evaluate(()=>window.streams[0].getTracks().every(t=>t.readyState==='ended')),true);
  fs.mkdirSync('../../ui-review',{recursive:true});
  await page.screenshot({path:'../../ui-review/booking-face-captured-mobile.png'});
  await page.click('[data-face-save]');await page.waitForFunction(()=>document.querySelector('[data-face-status]').textContent.includes('Connection lost'));
  assert.equal(await page.evaluate(()=>window.resumed),0);assert.equal(await page.locator('[data-face-preview]').isVisible(),true);
  await page.click('[data-face-save]');await page.waitForFunction(()=>window.resumed===1);
  assert.equal(await page.locator('.passenger-face-overlay').count(),0);assert.equal(await page.evaluate(()=>window.saved),2);
  // A saved profile can resume, while cancellation never submits a booking.
  await page.click('#book');await page.click('[data-face-open]');await page.waitForSelector('[data-face-shutter]:not([hidden]):not([disabled])');
  await page.click('[data-face-cancel]');assert.equal(await page.evaluate(()=>window.cancelled),'booking-face-cancelled');
  assert.equal(await page.evaluate(()=>window.resumed),1);assert.equal(await page.evaluate(()=>window.streams[1].getTracks().every(t=>t.readyState==='ended')),true);
  // Cancelling while an upload is in flight may save the picture, but cannot resume a trip.
  await page.evaluate(()=>{
   window.startBooking=()=>window.AsiyePassengerOnboarding.open({name:'Mandla',save:()=>new Promise(resolve=>{window.finishUpload=resolve;})})
     .then(()=>window.resumed++,e=>{window.cancelled=e.code;});
   document.getElementById('book').onclick=window.startBooking;
  });
  await page.click('#book');await page.click('[data-face-open]');await page.waitForSelector('[data-face-shutter]:not([hidden]):not([disabled])');
  await page.click('[data-face-shutter]');await page.click('[data-face-save]');
  await page.click('[data-face-cancel]');await page.evaluate(()=>window.finishUpload('https://test.invalid/late.jpg'));
  await page.evaluate(()=>Promise.resolve());assert.equal(await page.evaluate(()=>window.resumed),1);
  assert.deepEqual(errors,[]);
  console.log('PASS mobile camera preview/capture/save retry/resume/cancel and camera shutdown.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
