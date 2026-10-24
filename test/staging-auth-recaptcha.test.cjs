'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseConfig}=require('../scripts/rebuild_staging_auth_preview.cjs');
const repoPaths=['assets/driver-v2/js/login.js'];
function scenario(filepath){
 const src=fs.readFileSync(filepath,'utf8');
 const start=src.indexOf('    prepareRecaptcha() {');
 const end=src.indexOf('    /* ========================================================',start+20);
 assert.ok(start>=0&&end>start,filepath+' missing verifier methods');
 let constructed=0,rendered=0,cleared=0,reset=0;
 const auth=()=>({});
 class Verifier{
  constructor(){constructed++;}
  render(){rendered++;return Promise.resolve(7);}
  clear(){cleared++;}
 }
 auth.RecaptchaVerifier=Verifier;
 const sandbox={
   firebase:{auth},
   document:{getElementById:id=>id==='recaptcha-container'?{}:null},
   window:{grecaptcha:{reset:()=>{reset++;}}},
   console:{log(){},warn(){},error(){}},
   Promise,Number
 };
 const obj=vm.runInNewContext('({'+src.slice(start,end)+'})',sandbox);
 return {obj,read:()=>({constructed,rendered,cleared,reset}),src};
}
for(const file of repoPaths){
 test(file+' reuses one verifier through concurrent initializations and expired callback',async()=>{
  const {obj,read}=scenario(file);
  const [a,b]=await Promise.all([obj.prepareRecaptcha(),obj.prepareRecaptcha()]);
  assert.strictEqual(a,b);
  assert.strictEqual(await obj.prepareRecaptcha(),a);
  assert.deepEqual(read(),{constructed:1,rendered:1,cleared:0,reset:0});
  obj.resetRecaptchaWidget();
  assert.deepEqual(read(),{constructed:1,rendered:1,cleared:0,reset:1});
 });
 test(file+' awaits render before sending OTP, never reinits after disabled-region error',()=>{
  const {src}=scenario(file);
  const fn=src.slice(src.indexOf('    async sendOtp() {'),src.indexOf('    async verifyOtp() {'));
  assert.match(fn,/await this\.prepareRecaptcha\(\)/);
  assert.match(fn,/current\.linkWithPhoneNumber\(phone, verifier\)/);
  assert.match(fn,/this\.resetRecaptchaWidget\(\)/);
  assert.match(src,/case 'auth\/operation-not-allowed':/);
  const resend=src.slice(src.indexOf('    resendOtp() {')>=0?
    src.indexOf('    resendOtp() {'):src.indexOf('    async resendOtp() {'),
    src.indexOf('    startResendTimer() {'));
  assert.doesNotMatch(resend,/this\.prepareRecaptcha\(\)/);
 });
}
test('staging preview config parser rejects production and validates staging identifiers',()=>{
 const source=fs.readFileSync('scripts/rebuild_staging_auth_preview.cjs','utf8');
 assert.match(source,/run\(\['config','get-value','project'\],'gcloud'\)/);
 assert.match(source,/run\(\['diff','--name-only','HEAD','--','assets'\]\)/);
 assert.match(source,/requireStagingConfig\(obj,PROJECT\)/);
 assert.match(source,/createStagingPreview/);
 assert.match(source,/No cloud deployment/);
 const cfg={
  apiKey:'AIza'+'A'.repeat(26),authDomain:'asiye-paystack-staging.firebaseapp.com',
  databaseURL:'https://asiye-paystack-staging-default-rtdb.firebaseio.com',
  projectId:'asiye-paystack-staging',storageBucket:'asiye-paystack-staging.firebasestorage.app',
  messagingSenderId:'1000800408896',appId:'1:1000800408896:web:abc123456789'
 };
 const input='const firebaseConfig = {'+Object.entries(cfg).map(([k,v])=>k+': "'+v+'"').join(',')+'}';
 assert.equal(parseConfig(input).projectId,cfg.projectId);
 assert.throws(()=>parseConfig(input.replaceAll('asiye-paystack-staging','asiye-80386')));
});
