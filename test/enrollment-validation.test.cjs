const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('assets/driver-v2/js/enrollment-validation.js','utf8'),context);const validation=context.window.EnrollmentValidation;
test('phone validation accepts readable local and international numbers',()=>{for(const value of ['082 123 4567','+27 82 123 4567','(082) 123-4567','+44 20 7946 0958'])assert.equal(validation.phone(value),true,value);});
test('phone validation rejects missing, short, alphabetic and malformed numbers',()=>{for(const value of ['', 'abc1234567','123','++27821234567','082/123/4567','1234567890123456'])assert.equal(validation.phone(value),false,value);});
test('reference duplicates normalize South African country codes',()=>{assert.equal(validation.phoneKey('082 123 4567'),validation.phoneKey('+27 82 123 4567'));});
test('HTML patterns compile under modern browsers and wizard contains six sections',()=>{const html=fs.readFileSync('assets/driver-v2/enrollment.html','utf8');for(const [,pattern]of html.matchAll(/pattern="([^"]+)"/g))assert.doesNotThrow(()=>new RegExp(pattern,'v'));assert.equal((html.match(/<fieldset>/g)||[]).length,6);assert.ok(html.includes('novalidate'));assert.ok(!fs.readFileSync('assets/driver-v2/js/enrollment.js','utf8').includes('pattern="[+0-9 ()-]'));});

test('licence accepts PDF and supported image signatures even without a MIME type',async()=>{
 for(const [bytes,type] of [
  [[37,80,68,70,45],'application/pdf'],[[255,216,255,224],'image/jpeg'],
  [[137,80,78,71,13,10,26,10],'image/png'],[[82,73,70,70,0,0,0,0,87,69,66,80],'image/webp']
 ]) assert.equal(await validation.licenceType(new Blob([new Uint8Array(bytes)])),type);
});
test('licence rejects empty, oversized and unsupported files regardless of claimed MIME',async()=>{
 for(const file of [null,new Blob([]),new Blob(['not a pdf'],{type:'application/pdf'}),new Blob([new Uint8Array(10*1024*1024+1)])]) assert.equal(await validation.licenceType(file),null);
});
test('references serialize to exactly the named children required by database rules',()=>{
 const fields=new Map();for(let i=1;i<=3;i++){fields.set(`refName${i}`,` Person ${i} `);fields.set(`refPhone${i}`,`082123456${i}`);fields.set(`refRelation${i}`,' Friend ');}
 const refs=JSON.parse(JSON.stringify(validation.references(fields)));
 assert.deepEqual(Object.keys(refs),['reference1','reference2','reference3']);
 const rules=JSON.parse(fs.readFileSync('test/enrollment.rules.fragment.json','utf8')).rules.driverEnrollments.$uid.references;
 for(const [key,ref]of Object.entries(refs)){assert.ok(rules[key]);assert.deepEqual(Object.keys(ref),['name','phone','relationship']);assert.equal(ref.relationship,'Friend');assert.equal(ref.name,`Person ${key.slice(-1)}`);}
 assert.equal(rules.$other['.validate'],false);
});
