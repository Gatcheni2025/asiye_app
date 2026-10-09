const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=name=>fs.readFileSync(name,'utf8');
test('passenger saved face URL checked before completing OTP sign-in',()=>{
 const login=read('assets/passenger-v2/js/login.js');
 const profile=read('assets/passenger-v2/js/profile.js');
 const backend=read('functions/index.js');
 assert.match(login,/storedFaceAvailable/);
 assert.match(login,/new Image\(\)/);
 assert.match(login,/uploaded\.url/);
 assert.match(backend,/imageProbe/);
 assert.match(backend,/!imageProbe\.ok/);
 assert.match(profile,/image\.onerror/);
 assert.match(profile,/Never open a camera or upload an image from within a payment/);
});
test('wallet verification and trip holds use atomic Firebase Admin transactions',()=>{
 const backend=read('functions/index.js');
 const c=backend.slice(backend.indexOf('async function creditPaystackWallet('),backend.indexOf('async function updateWalletProfileWithEtag('));
 const h=backend.slice(backend.indexOf('async function updateWalletProfileWithEtag('),backend.indexOf('async function holdWalletTripPayment('));
 assert.match(c,/ref\.transaction\(profile =>/);
 assert.match(c,/applyWalletCredit/);
 assert.doesNotMatch(c,/adminDatabaseAccessToken/);
 assert.match(h,/walletRef\.transaction\(profile =>/);
 assert.doesNotMatch(h,/If-Match/);
 const wallet=read('assets/passenger-v2/js/wallet.js');
 assert.match(wallet,/reconcileWalletTopup/);
 assert.match(read('assets/passenger-v2/js/app.js'),/visibilitychange/);
});
test('booking checks saved profile without triggering camera or uploading during card checkout',()=>{
 const profile=read('assets/passenger-v2/js/profile.js');
 const guard=profile.slice(profile.indexOf('async ensureRequired()'),profile.indexOf('bindAccount('));
 assert.match(guard,/Open Account/);
 assert.doesNotMatch(guard,/this\.scanAndSave\(/);
 assert.match(read('assets/passenger-v2/js/booking.js'),/ensureRequired/);
});
test('enrollment camera captures licence, ID and car through native shutter',()=>{
 const flutter=read('lib/main.dart');
 const js=read('assets/driver-v2/js/enrollment.js');
 for(const purpose of ['driver-vehicle','driver-licence','driver-identity','driver-address-proof']){
  assert.ok(flutter.includes("normalizedPurpose == '"+purpose+"'") ||
    flutter.includes("normalizedPurpose.contains('"+purpose+"')"));
  assert.ok(js.includes(purpose));
 }
 assert.match(js,/capturedDocuments\.licence/);
 assert.match(js,/uploadDriverEnrollmentDocument/);
 assert.doesNotMatch(js,/firebase\.storage\(\)\.ref\(path\)\.put/);
});
test('secure document service checks user token and object content',()=>{
 const backend=read('functions/index.js');
 const src=backend.slice(backend.indexOf('exports.uploadDriverEnrollmentDocument ='),backend.indexOf('// --- DRIVER VEHICLE REVIEW SUBMISSION'));
 for(const fragment of ['verifyIdToken','actor.phone_number','driverEnrollments/',
  'application/pdf','file.save','getMetadata','ifGenerationMatch']) assert.ok(src.includes(fragment),fragment);
});
test('address autocomplete restricted to South African Mapbox Geocoding v6',()=>{
 const address=read('assets/driver-v2/js/enrollment-address.js');
 assert.match(address,/search\/geocode\/v6\/forward/);
 assert.match(address,/country: 'za'/);
 assert.match(address,/encodeURIComponent|URLSearchParams/);
 const html=read('assets/driver-v2/enrollment.html');
 assert.match(html,/id="addressSuggestions"/);
 assert.match(html,/enrollment-address.js/);
});
test('bank dropdown fills six-digit branch code',()=>{
 const bank=read('assets/driver-v2/js/enrollment-banks.js');
 const html=read('assets/driver-v2/enrollment.html');
 for(const code of ['250655','470010','051001','198765','632005'])assert.ok(bank.includes(code));
 assert.match(bank,/branch\.value = bank\.selectedOptions/);
 assert.match(html,/name="branchCode"/);
 assert.match(html,/enrollment-banks.js/);
});

test('passenger registration does not depend on client commuter write permissions',()=>{
 const login=read('assets/passenger-v2/js/login.js');
 const backend=read('functions/index.js');
 const flow=login.slice(login.indexOf('async createPassengerProfile()'),login.indexOf('/* ========================================================\n       COMPLETE LOGIN'));
 assert.match(flow,/completeSignup: true/);
 assert.match(flow,/fullName: name/);
 assert.doesNotMatch(flow,/root\.update\(/);
 assert.match(backend,/const signup = role === "passenger"/);
 assert.match(backend,/onboardingCompleted: true/);
 assert.match(backend,/phone: verifiedPhone/);
});
test('ID and residential proof use rear photo capture on old and new Android APKs',()=>{
 const js=read('assets/driver-v2/js/enrollment.js');
 const flutter=read('lib/main.dart');
 assert.match(js,/nativeCapture\('driver-vehicle'\)/);
 assert.match(js,/driver-identity is a document, never a face scan/);
 assert.match(flutter,/normalizedPurpose == 'driver-identity'/);
 assert.match(flutter,/normalizedPurpose == 'driver-address-proof'/);
 assert.match(flutter,/AsiyeVehicleCameraScreen/);
});
test('missing upload endpoint is explained instead of generic failed to fetch',()=>{
 const js=read('assets/driver-v2/js/enrollment.js');
 const backend=read('functions/index.js');
 assert.match(js,/Could not reach the driver document upload service/);
 assert.match(js,/HTTP 404/);
 assert.match(js,/uploadDriverEnrollmentDocument/);
 assert.match(backend,/contentSha256/);
 assert.match(backend,/fromExisting/);
});
