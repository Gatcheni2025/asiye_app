const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixture=require('./ride-confirmation-fixture.cjs');
const root=path.join(__dirname,'../..');

(async()=>{
  const output=path.join(root,'ui-review');fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try {
    for(const [width,height] of [[390,844],[360,800],[320,640]]){
      const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
      await page.route('https://fixture.test/**',async route=>{
        const file=route.request().url().endsWith('profile.png')?'assets/data/profile.png':'assets/assets/img/taxi.png';
        await route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(root,file))});
      });
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="position:absolute;inset:0;background-color:#e7ece6;background-image:linear-gradient(25deg,transparent 48%,#fff 48%,#fff 51%,transparent 51%),linear-gradient(110deg,transparent 48%,#d6dfd2 48%,#d6dfd2 51%,transparent 51%);background-size:100px 150px,140px 200px"></div><div class="bottom-sheet open"><div style="width:35px;height:4px;border-radius:5px;background:#ddd;margin:1px auto 13px"></div><div id="sheetContent"></div></div>');
      await page.addStyleTag({content:fs.readFileSync(path.join(root,'assets/passenger-v2/css/app.css'),'utf8')});
      await page.evaluate('('+fixture.bootstrap.toString()+')()');
      await page.addScriptTag({content:fs.readFileSync(path.join(root,'assets/passenger-v2/js/ride-controller.js'),'utf8')});
      await page.evaluate(request=>{
        ASIYE.ride.renderDriverAssigned(request);ASIYE.ride.renderTripSummary(request,'accepted');
      },fixture.request);
      await page.waitForTimeout(450);
      const layout=await page.evaluate(()=>{
        const vehicle=document.querySelector('.ride-match-car-photo').getBoundingClientRect();
        return {width:document.documentElement.scrollWidth,viewport:innerWidth,
          vehicleWidth:vehicle.width,vehicleHeight:vehicle.height,
          callHeight:document.querySelector('.ride-match-actions a').getBoundingClientRect().height};
      });
      assert.ok(layout.width<=layout.viewport,JSON.stringify(layout));
      assert.ok(layout.vehicleWidth<=80&&layout.vehicleHeight<=60,JSON.stringify(layout));
      assert.ok(layout.callHeight>=44,JSON.stringify(layout));
      await page.screenshot({path:path.join(output,`ride-confirmation-${width}.png`)});
      await page.close();
    }
  } finally {await browser.close();}
  console.log('PASS: 390, 360 and 320 pixel phone layouts, bounded photos and accessible action targets.');
})().catch(e=>{console.error(e);process.exitCode=1;});
