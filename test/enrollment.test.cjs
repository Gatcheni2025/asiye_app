const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(approval,fail=false,user={uid:'driver'}){let redirect;const context={console:{warn(){}},firebase:{auth:()=>({currentUser:user}),database:()=>({ref:()=>({once:async()=>{if(fail)throw Error('denied');return {val:()=>approval};}})})},location:{replace:url=>redirect=url}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('assets/driver-v2/js/enrollment-gate.js','utf8'),context);return {gate:context.AsiyeEnrollment,redirect:()=>redirect};}
test('only version-1 approved drivers pass enrollment',async()=>{for(const value of [null,{status:'pending'},{status:'rejected'},{status:'approved',version:0}]){const app=setup(value);assert.equal(await app.gate.requireApproval(),false);assert.equal(app.redirect(),'./enrollment.html');}assert.equal(await setup({status:'approved',version:1}).gate.requireApproval(),true);});
test('failed approval reads and signed-out sessions fail closed',async()=>{assert.equal(await setup(null,true).gate.requireApproval(),false);const app=setup(null,false,null);assert.equal(await app.gate.requireApproval(),false);assert.equal(app.redirect(),'./login.html');});

test('legacy verified taxi profile can pass migration gate', async () => {
  const app = setup(null);
  assert.equal(
    await app.gate.requireApproval({verificationStatus:'verified'}),
    true
  );
});

test('deactivated legacy taxi profile cannot pass migration gate', async () => {
  const app = setup(null);
  assert.equal(
    await app.gate.requireApproval({
      verificationStatus:'unverified',
      provisionalActivation:true
    }),
    false
  );
  assert.equal(app.redirect(),'./enrollment.html');
});
