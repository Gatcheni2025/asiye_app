const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {handle}=require('../functions/admin-operations');

const root=p=>fs.readFileSync(p,'utf8');
function sandbox(){
 const records={},audit=[];
 const admin={
   database:Object.assign(()=>({ref:(path)=>{
     if(path==='adminInvitations'||path==='refundCases')return {
       push:()=>{
         const key='case_12345';
         return {key,async set(obj){records[path+'/'+key]=obj;}};
       }
     };
     return {
       async once(){return {val:()=>records[path]||null};},
       async update(obj){records[path]={...(records[path]||{}),...obj};}
     };
   }}),{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}})
 };
 const actor={uid:'admin_1',email:'admin@test.invalid'};
 return {records,audit,admin,actor,execute:data=>handle({
   data,actor,admin,audit:async(a,operation,id,payload)=>{
     audit.push({operation,id,payload});
   }
 })};
}
test('root admin page is separate from driver and passenger pages',()=>{
 const html=root('assets/admin/index.html');
 const app=root('assets/admin/console.js');
 const cfg=JSON.parse(root('firebase.json'));
 assert.match(html,/<title>Asiye Operations/);
 assert.match(html,/name="robots" content="noindex,nofollow/);
 assert.match(html,/id="loginForm"/);
 assert.match(html,/id="navigation"/);
 assert.match(html,/console.js/);
 assert.ok(cfg.hosting.rewrites.some(r=>r.source==='/admin'&&r.destination==='/admin/index.html'));
 for(const view of ['overview','enrollments','drivers','passengers','bookings','parcels','wallets',
   'payments','earnings','payouts','refunds','support','documents','invitations','audit'])
   assert.ok(html.includes('data-view="'+view+'"'),'Missing '+view);
 assert.match(app,/adminWhoAmI/);
 assert.match(app,/adminFetchData/);
 assert.match(app,/adminManagePlatform/);
 assert.match(app,/reviewDriverEnrollment/);
 assert.match(app,/adminOperations/);
 assert.doesNotMatch(app,/firebase\.database\s*\(/);
});
test('admin fetch is allowlisted and accessible only after admin authorization',()=>{
 const src=root('functions/index.js');
 const read=src.slice(src.indexOf('exports.adminFetchData ='),src.indexOf('// PUBLIC ACCOUNT DELETION REQUEST',src.indexOf('exports.adminFetchData =')));
 assert.match(read,/await requireAsiyeAdmin\(context\)/);
 assert.match(read,/"refundCases"/);
 assert.match(read,/"adminInvitations"/);
 const op=src.slice(src.indexOf('exports.adminOperations ='),src.indexOf('exports.adminFetchData ='));
 assert.match(op,/await requireAsiyeAdmin\(context\)/);
});
test('register user creates invitation only; does not create Auth user',async()=>{
 const h=sandbox();
 const result=await h.execute({action:'inviteUser',fullName:'New Rider',phone:'082 111 2233',role:'passenger'});
 assert.equal(result.ok,true);
 assert.equal(result.status,'invited');
 assert.equal(h.records['adminInvitations/case_12345'].role,'passenger');
 assert.equal(h.audit[0].operation,'registration_invited');
 assert.doesNotMatch(root('functions/admin-operations.js'),/createUser\s*\(/);
});
test('refund cases are manual and cannot issue money movements',async()=>{
 const h=sandbox();
 const result=await h.execute({action:'createRefundCase',
   providerReference:'paystack_test_reference',amount:70,reason:'Duplicate charge'});
 assert.equal(result.ok,true);
 const ref=h.records['refundCases/case_12345'];
 assert.equal(ref.status,'open');
 assert.equal(ref.disbursed,false);
 assert.match(ref.note,/NOT been issued/);
 assert.equal(h.audit[0].operation,'refund_case_created');
 await h.execute({action:'updateRefundCase',id:'case_12345',status:'awaiting_gateway',
   note:'Investigating gateway reference'});
 assert.equal(h.records['refundCases/case_12345'].disbursed,false);
 await assert.rejects(h.execute({action:'updateRefundCase',id:'case_12345',status:'paid',
   note:'Pretend payout'}),/Invalid refund case or status/);
 const backend=root('functions/admin-operations.js');
 assert.doesNotMatch(backend,/paystack\.refund|initiateTransfer|createTransfer/);
});
test('refund creation requires positive amount and traceable payment',async()=>{
 const h=sandbox();
 await assert.rejects(h.execute({action:'createRefundCase',amount:100,reason:'Unspecified'}),/trip ID or gateway/);
 await assert.rejects(h.execute({action:'createRefundCase',providerReference:'x',amount:-10,reason:'invalid'}),/positive refund/);
});

test('full operations access excludes enrollment-only reviewers',()=>{
 const src=root('functions/index.js');
 const start=src.indexOf('async function requireAsiyeAdmin(');
 const end=src.indexOf('async function requireAsiyeEnrollmentReviewer(',start);
 const block=src.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.doesNotMatch(block,/token\.enrollmentReviewer === true/);
 assert.match(block,/token\.asiyeAdmin === true/);
 const reviewer=src.slice(end,src.indexOf('function safeAdminString(',end));
 assert.match(reviewer,/token\?\.enrollmentReviewer === true/);
 assert.match(src,/const actor = await requireAsiyeEnrollmentReviewer\(context\)/);
});
test('details action identifiers always use server Firebase collection keys',()=>{
 const src=root('assets/admin/console.js');
 assert.match(src,/\.map\(\(\[id,record\]\)=>\(\{\.\.\.record,id\}\)\)/);
 assert.doesNotMatch(src,/\.map\(\(\[id,record\]\)=>\(\{id,\.\.\.record\}\)\)/);
});
