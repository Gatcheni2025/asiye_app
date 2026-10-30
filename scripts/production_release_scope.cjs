'use strict';
const {productionFunctions,SECRET_FUNCTIONS}=require('./production_card_preflight.cjs');
const FUNDING_OFF=Object.freeze(['createEftSmsTopup','initializePaystackWalletTopup']);
const FUNCTIONS=Object.freeze([...productionFunctions(),...FUNDING_OFF]);
const SECRET_CONSUMERS=Object.freeze([...SECRET_FUNCTIONS,'initializePaystackWalletTopup']);
const ENTRY='production-index.generated.cjs';
if(FUNCTIONS.length!==44||new Set(FUNCTIONS).size!==44||FUNCTIONS.includes('adminStagingTestConsole'))throw Error('PRODUCTION_SCOPE_INVALID');
function renderEntry(){return [
 '"use strict";',
 '// Generated production promotion; unrelated deployed exports are preserved.',
 'const all=require("./index.js");',
 'const params=require("firebase-functions/params");',
 'if(!Array.isArray(params.declaredParams))throw Error("Secret registry unavailable");',
 'const omitted=new Set(["TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","TWILIO_FROM_NUMBER"]);',
 'for(let i=params.declaredParams.length-1;i>=0;i--)if(omitted.has(params.declaredParams[i].name))params.declaredParams.splice(i,1);',
 'if(!params.declaredParams.some(p=>p.name==="PAYSTACK_SECRET_KEY"))throw Error("Paystack secret missing");',
 'const names='+JSON.stringify(FUNCTIONS)+';',
 'for(const name of names)if(typeof all[name]!=="function")throw Error("Missing reviewed export: "+name);',
 'module.exports=Object.fromEntries(names.map(name=>[name,all[name]]));',''].join('\n');}
module.exports={FUNDING_OFF,FUNCTIONS,SECRET_CONSUMERS,ENTRY,renderEntry};
