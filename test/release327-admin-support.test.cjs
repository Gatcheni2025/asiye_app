const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const admin = read('assets/admin.html');
const portal = read('assets/admin-release.js');
const members = read('assets/member-pages.js');
const support = read('assets/support-chat.js');
const backend = read('functions/index.js');
const main = read('lib/main.dart');
const camera = read('lib/vehicle_camera_screen_native.dart');
const rules = JSON.parse(read('database.rules.json')).rules;

test('build 328 retains compatible administrator title', () => {
  assert.match(read('pubspec.yaml'), /^version: 11\.0\.58\+328$/m);
  assert.match(admin, /Asiye Admin 11\.0\.57/);
  assert.match(admin, /data-release-view="vehicle"/);
  assert.match(admin, /data-release-view="support"/);
  assert.match(admin, /admin-release\.js\?v=327/);
  assert.match(admin, /adminWhoAmI/);
});

test('image review uses authenticated Cloud Functions and requires a photo', () => {
  assert.match(portal, /adminFetchData/);
  assert.match(portal, /adminManagePlatform/);
  assert.match(portal, /reviewVehicle/);
  assert.match(portal, /Approve photo & edits/);
  assert.match(portal, /Request changes/);
  assert.match(backend, /if \(action === "reviewVehicle"\)/);
  assert.match(backend, /String\(driver\.vehiclePhoto \|\| ""\)\.trim\(\)/);
  assert.match(backend, /vehicleReviewedBy: actor\.uid/);
  assert.match(backend, /vehicleApprovalStatus: "not_submitted"/);
});

test('admin image viewer refuses javascript and off-domain images', () => {
  const context = { window: {}, URL, firebase: { functions() {} } };
  context.window = context;
  vm.runInNewContext(portal, context);
  const safeImage = context.AsiyeAdminRelease.safeImage;
  assert.equal(safeImage('javascript:alert(1)'), '');
  assert.equal(safeImage('https://example.org/img.jpg'), '');
  assert.equal(safeImage('http://firebasestorage.googleapis.com/file'), '');
  assert.equal(safeImage('https://firebasestorage.googleapis.com/v0/b/example/o/a.jpg'),
    'https://firebasestorage.googleapis.com/v0/b/example/o/a.jpg');
});

test('support is visible to driver/passenger and admin can reply', () => {
  for (const file of ['assets/driver-v2/index.html','assets/passenger-v2/index.html']) {
    assert.match(read(file), /support-chat\.js/);
  }
  assert.match(members, /data-support-conversations/);
  assert.match(members, /AsiyeSupportChat\?\.mount/);
  assert.match(support, /orderByChild\('authUid'\)\.equalTo\(user\.uid\)/);
  assert.match(support, /activeRoot\.child\('messages'\)\.push\(\)\.set/);
  assert.match(portal, /replySupport/);
  assert.match(backend, /if \(action === "replySupport"\)/);
});

test('support Firebase rules enforce query scope and immutable owner messages', () => {
  const chat = rules.support_chats;
  assert.match(chat['.read'], /query\.orderByChild === 'authUid'/);
  assert.match(chat['.read'], /query\.equalTo === auth\.uid/);
  assert.ok(chat['.indexOn'].includes('authUid'));
  const msg = chat.$ticket.messages.$message;
  assert.match(msg['.write'], /!data\.exists\(\)/);
  assert.match(msg['.write'], /data\.parent\(\)\.parent\(\)\.child\('authUid'\)/);
  assert.match(msg['.write'], /senderUid/);
  assert.match(msg['.validate'], /text/);
});

test('car camera stays inside the app and returns image automatically', () => {
  assert.match(main, /AsiyeVehicleCameraScreen/);
  assert.match(main, /normalizedPurpose == 'driver-vehicle'/);
  assert.match(camera, /CameraLensDirection\.back/);
  assert.match(camera, /Navigator\.of\(context\)\.pop\(photo\.path\)/);
  assert.match(members, /preserveAspectRatio: options\.purpose === 'driver-vehicle'/);
  assert.match(members, /carPreview\.src = capture\.dataUrl/);
  assert.match(members, /object-fit:contain/);
});
