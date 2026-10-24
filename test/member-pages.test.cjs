const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function element() { return { innerHTML:'', children:{}, setAttribute(){}, append(){}, close(){}, remove(){}, showModal(){}, addEventListener(){}, insertAdjacentHTML(position,html){assert.equal(position,'beforeend');this.innerHTML+=html;}, querySelector(key){ return this.children[key] ||= element(); } }; }
function load(driver, fail = false) {
    const queries=[],alerts=[];
    const context = {
        alert: message => alerts.push(message),
        localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
        document:{createElement:element,body:element(),head:{appendChild:()=>{}},getElementById:()=>null},
        firebase:{auth:()=>({currentUser:null}),database:()=>({ref(root){queries.push(root);return {orderByChild(){return this;},equalTo(){return this;},startAt(){return this;},limitToLast(){return this;},async once(){if(fail)throw Error('denied');return {val(){return null;},exists(){return false;},forEach(){}};}};}})},
        [driver?'ASIYE_DRIVER':'ASIYE']:{state:{userId:'p',driverId:'d',user:{name:'Passenger',credits:0},driver:{name:'Driver',vehicleReg:'TEST'}}}
    };
    context.window=context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/member-pages.js'),'utf8'),context);
    return {pages:context.AsiyePages,queries,alerts,context};
}
for (const driver of [false,true]) test(`${driver?'driver':'passenger'} menu pages render content`,async()=>{
    const {pages}=load(driver);
    const names=driver?['earnings','trips','club','parcels','vehicle','safety','support','account']:['trips','parcels','safety','support','account'];
    for(const name of names){await pages.open(name);const html=pages.dialog.querySelector('main').innerHTML;assert.ok(html.length>50,name);assert.ok(!html.includes('Loading…'),name);}
});
test('retired Wallet cannot open a funding page',async()=>{
    const {pages,queries,alerts}=load(false);
    await pages.open('wallet');
    assert.equal(alerts.length,1);
    assert.match(alerts[0],/Wallet is discontinued/);
    assert.equal(pages.dialog,undefined);
    assert.deepEqual(queries,[]);
});
test('database errors produce a retry page instead of a false empty history',async()=>{
    const {pages}=load(false,true);await pages.open('trips');assert.match(pages.dialog.querySelector('main').innerHTML,/could not load/);
});
test('wallet preserves zero balances and profile text is escaped',()=>{
    const {pages}=load(false);assert.equal(pages.money(0),'R0.00');assert.equal(pages.money(undefined),'Not available');assert.equal(pages.escape('<script>'),'&lt;script&gt;');
});

test('vehicle updates offer only supported physical categories',async()=>{
 const {pages}=load(true);await pages.open('vehicle');
 const html=pages.dialog.querySelector('main').innerHTML;
 const select=html.match(/<select name="type"[\s\S]*?<\/select>/)[0];
 assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),['sedan','hatchback']);
 assert.doesNotMatch(html,/SUV|Minibus|7-seater/);
 assert.match(html,/Sedan and Hatchback vehicles only/);
});

test('web checkout uses one current tab; native checkout keeps its external navigation bridge',()=>{
 const web=load(false);web.context.location={};
 web.context.open=()=>assert.fail('Do not create a duplicate noopener checkout popup');
 web.pages.openExternalPayment('https://checkout.paystack.com/test-only');
 assert.equal(web.context.location.href,'https://checkout.paystack.com/test-only');
 const native=load(false),messages=[];native.context.location={};
 native.context.AndroidNav={postMessage:value=>messages.push(JSON.parse(value))};
 native.pages.openExternalPayment('https://checkout.paystack.com/test-only');
 assert.deepEqual(messages,[{action:'external_nav',url:'https://checkout.paystack.com/test-only'}]);
 assert.equal(native.context.location.href,undefined);
});
