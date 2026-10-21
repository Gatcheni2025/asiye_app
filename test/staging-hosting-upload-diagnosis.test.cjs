'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {inspectLog,versionSummary,statusCounts}=require('../scripts/diagnose_staging_hosting_upload.cjs');
test('sanitizes upload failure stages and HTTP codes',()=>{
 const privateLog=[
   '[debug] >>> [apiv2][query] POST https://firebasehosting.googleapis.com/v1beta1/sites/asiye-paystack-staging/versions',
   '[debug] >>> POST https://firebasehosting.googleapis.com/v1beta1/sites/asiye-paystack-staging/versions/version-secret:populateFiles',
   '[debug] <<< [apiv2][status] POST https://upload-firebasehosting.googleapis.com/upload/private-hash 403',
   '[error] Error: Failed to upload files to Hosting site. Permission denied. Authorization: Bearer DO_NOT_LEAK'
 ].join('\n');
 const report=inspectLog(privateLog);
 assert.ok(report.httpCodes.includes('403'));
 assert.ok(report.errorCategories.some(([n])=>n==='PERMISSION_DENIED'));
 assert.ok(report.errorCategories.some(([n])=>n==='UPLOAD_FAILED'));
 assert.ok(report.stagesObserved.includes('FILE_UPLOAD'));
 assert.ok(report.stagesObserved.includes('POPULATE_FILES'));
 assert.doesNotMatch(JSON.stringify(report),/DO_NOT_LEAK|Bearer|private-hash|version-secret/);
});
test('no code or cause is guessed when log has only generic CLI warning',()=>{
 const report=inspectLog('Error: Unable to deploy Hosting\nNo further information');
 assert.deepEqual(report.httpCodes,[]);
 assert.ok(report.errorCategories.some(([name])=>name==='CLI_ERROR_MARKER'));
});
test('draft Hosting versions are summarized without IDs or email addresses',()=>{
 const summary=versionSummary({versions:[{
  name:'sites/asiye-paystack-staging/versions/private-123',
  status:'CREATED',createTime:'2026-10-21T18:20:00Z',createUser:{email:'secret@example.invalid'}
 },{name:'sites/production/versions/prod',status:'FINALIZED'}]});
 assert.equal(summary.count,1);
 assert.deepEqual(summary.states,['CREATED']);
 assert.doesNotMatch(JSON.stringify(summary),/private-123|secret@example|sites\/production/);
});
test('source is only GETs, with hard staging project guards',()=>{
 const s=fs.readFileSync('scripts/diagnose_staging_hosting_upload.cjs','utf8');
 assert.match(s,/NUMBER='1000800408896'/);
 assert.match(s,/method:'GET'/);
 assert.match(s,/\/versions\?pageSize=10/);
 assert.doesNotMatch(s,/method:'POST'|add-iam-policy-binding|firebase deploy|hosting:sites:create/);
});

test('draft file status counts classify only matching records and do not echo paths',()=>{
  const data={files:[
    {path:'/private-user.txt',hash:'do-not-leak',status:'EXPECTED'},
    {path:'/index.html',hash:'do-not-leak-again',status:'ACTIVE'},
    {path:'/other.txt',status:'EXPECTED'}
  ]};
  assert.equal(statusCounts(data,'EXPECTED'),2);
  assert.equal(statusCounts(data,'ACTIVE'),1);
  assert.equal(statusCounts(data,'DELETED'),0);
  assert.equal(statusCounts({},'EXPECTED'),0);
});
test('draft-file inspection is read-only and only logs counts, not file paths or hashes',()=>{
  const src=fs.readFileSync('scripts/diagnose_staging_hosting_upload.cjs','utf8');
  assert.match(src,/countFiles\(version\.name,token,'EXPECTED'\)/);
  assert.match(src,/countFiles\(version\.name,token,'ACTIVE'\)/);
  assert.match(src,/awaiting upload/);
  assert.match(src,/already uploaded/);
  assert.match(src,/method:'GET'/);
  assert.doesNotMatch(src,/console\.log\(\s*item\.path|console\.log\(\s*item\.hash|method:'POST'|method:'PATCH'/);
});
