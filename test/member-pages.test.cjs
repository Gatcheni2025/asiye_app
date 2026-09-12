const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function element() { return { innerHTML:'', children:{}, setAttribute(){}, append(){}, close(){}, remove(){}, showModal(){}, addEventListener(){}, querySelector(key){ return this.children[key] ||= element(); } }; }
function load(driver, fail = false) {
    const queries=[];
    const context = { document:{createElement:element,body:element()},
        firebase:{database:()=>({ref(root){queries.push(root);return {orderByChild(){return this;},equalTo(){return this;},startAt(){return this;},limitToLast(){return this;},async once(){if(fail)throw Error('denied');return {forEach(){}};}};}})},
        [driver?'ASIYE_DRIVER':'ASIYE']:{state:{userId:'p',driverId:'d',user:{name:'Passenger',credits:0},driver:{name:'Driver',vehicleReg:'TEST'}}}
    };
    context.window=context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/member-pages.js'),'utf8'),context);
    return {pages:context.AsiyePages,queries};
}
for (const driver of [false,true]) test(`${driver?'driver':'passenger'} menu pages render content`,async()=>{
    const {pages}=load(driver);
    const names=driver?['earnings','trips','club','vehicle','safety','support','account']:['trips','wallet','parcels','safety','support','account'];
    for(const name of names){await pages.open(name);const html=pages.dialog.querySelector('main').innerHTML;assert.ok(html.length>50,name);assert.ok(!html.includes('Loading…'),name);}
});
test('database errors produce a retry page instead of a false empty history',async()=>{
    const {pages}=load(false,true);await pages.open('trips');assert.match(pages.dialog.querySelector('main').innerHTML,/could not load/);
});
test('wallet preserves zero balances and profile text is escaped',()=>{
    const {pages}=load(false);assert.equal(pages.money(0),'R0.00');assert.equal(pages.money(undefined),'Not available');assert.equal(pages.escape('<script>'),'&lt;script&gt;');
});
