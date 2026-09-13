const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function load(fetch){const output={}; const ctx={console,URLSearchParams,fetch,setTimeout,clearTimeout,document:{getElementById:()=>output},ASIYE_CONFIG:{mapboxToken:'test'},ASIYE:{state:{location:{}},ui:{}}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/passenger-v2/js/places.js','utf8'),ctx);return {places:ctx.ASIYE.places,output};}
test('address fallback returns usable destination coordinates',async()=>{const {places}=load(async()=>({ok:true,json:async()=>({features:[{properties:{name:'Palm Boulevard',full_address:'Palm Boulevard, Umhlanga'},geometry:{coordinates:[31.06,-29.72]}}]})}));places.activeQuery='Palm';let results;places.renderSuggestions=value=>results=value;await places.searchAddresses('Palm');assert.equal(results[0].longitude,31.06);assert.equal(results[0].name,'Palm Boulevard');});
test('late search responses cannot replace current results',async()=>{const {places}=load(async()=>({ok:true,json:async()=>({features:[]})}));places.activeQuery='new';let renders=0;places.renderSuggestions=()=>renders++;await places.searchAddresses('old');assert.equal(renders,0);});
test('failed search shows an actionable error',async()=>{const {places,output}=load(async()=>({ok:false,status:403}));places.activeQuery='Palm';await places.searchAddresses('Palm');assert.match(output.textContent,/unavailable/);});
