const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function gate({ enrollment = null, approval = null, taxi = null, fails = false } = {}) {
  const location = { pathname: '/driver-v2/index.html', href: '', replace(value) { this.href = value; } };
  const user = { uid: 'driver-auth', phoneNumber: '+27821234567' };
  const firebase = {
    auth: () => ({ currentUser: user }),
    database: () => ({
      ref: root => ({
        async once() {
          if (fails) throw Error('permission_denied');
          if (root === 'driverEnrollments/driver-auth') return { val: () => enrollment };
          if (root === 'driverApprovals/driver-auth') return { val: () => approval };
          if (root === 'taxis/driver-auth') return { val: () => taxi, exists: () => !!taxi };
          throw Error('Unknown path: ' + root);
        },
        orderByChild() {
          return {
            equalTo() {
              return {
                limitToFirst() {
                  return { once: async () => ({ forEach() {} }) };
                }
              };
            }
          };
        }
      })
    })
  };
  const context = { console: { warn() {} }, window: { location }, firebase };
  vm.createContext(context);
  vm.runInContext(read('assets/driver-v2/js/enrollment-gate.js'), context);
  return { gate: context.window.AsiyeEnrollment, context, location, user };
}

test('new OTP-verified user gets seven registration steps', async () => {
  const { gate: e, user } = gate();
  assert.equal((await e.getStatus(user)).state, 'new');
  const html = read('assets/driver-v2/enrollment.html');
  assert.equal((html.match(/<fieldset>/g) || []).length, 7);
  assert.match(html, /Verified mobile number/);
  assert.match(html, /capture-selfie/);
  assert.match(html, /capture-car/);
  assert.match(html, /capture-identity/);
  assert.match(html, /name="licence"/);
  assert.match(html, /name="address"/);
  assert.match(html, /name="residentialAddress"/);
  assert.match(html, /logoutEnrollment/);
});

test('submitted v2 enrollment never restarts onboarding', async () => {
  const { gate: e, user, location } = gate({
    enrollment: { version: 2, status: 'pending' },
    taxi: { verificationStatus: 'pending', vehicleApprovalStatus: 'pending' }
  });
  assert.equal((await e.getStatus(user)).state, 'pending');
  assert.equal(await e.requireApproval(), false);
  assert.equal(location.href, './enrollment.html');
});

test('v2 administrator approval releases driver to the dashboard', async () => {
  const { gate: e, user, location } = gate({
    enrollment: { version: 2, status: 'approved' },
    approval: { version: 2, status: 'approved' },
    taxi: { authUid: 'driver-auth', verificationStatus: 'verified', vehicleApproved: true }
  });
  assert.equal((await e.getStatus(user)).state, 'approved');
  assert.equal(await e.requireApproval(), true);
  assert.equal(location.href, '');
});

test('legacy verified taxi without new enrollment stays approved', () => {
  const { gate: e } = gate();
  assert.equal(e.stateFromRecords({
    enrollment: null, approval: null,
    driver: { verificationStatus: 'verified', vehicleApproved: true }
  }).state, 'approved');
});

test('rejected and suspended drivers cannot restart', () => {
  const { gate: e } = gate();
  assert.equal(e.stateFromRecords({
    enrollment: { status: 'pending' },
    approval: { version: 2, status: 'rejected', reason: 'Unclear licence' }
  }).state, 'rejected');
  assert.equal(e.stateFromRecords({
    enrollment: null, approval: null,
    driver: { verificationStatus: 'suspended' }
  }).state, 'rejected');
});

test('database read failure never triggers fresh enrollment', async () => {
  const { gate: e, user, location } = gate({ fails: true });
  await assert.rejects(e.getStatus(user));
  assert.equal(await e.requireApproval(), false);
  assert.equal(location.href, './enrollment.html');
});

test('registration uploads all five documents once, locks pending and permits logout', () => {
  const source = read('assets/driver-v2/js/enrollment.js');
  assert.match(source, /nativeCapture\(purpose\)/);
  assert.match(source, /driver-enrollment-face/);
  assert.match(source, /driver-vehicle/);
  assert.match(source, /licence:file,address:addressFile/);
  assert.match(source, /residentialAddress: String/);
  assert.match(source, /form\.hidden = true/);
  assert.match(source, /logoutEnrollment/);
  assert.match(source, /firebase\.auth\(\)\.signOut\(\)/);
  assert.match(source, /AsiyeEnrollment\.getStatus\(user\)/);
});

test('admin shows new enrollments and cannot approve missing documents', () => {
  const releaseAdmin = read('assets/admin-release.js');
  const backend = read('functions/index.js');
  assert.match(read('assets/admin.html'), /New Driver Approvals/);
  assert.match(releaseAdmin, /showEnrollments/);
  assert.match(releaseAdmin, /reviewDriverEnrollment/);
  assert.match(releaseAdmin, /Proof of address/);
  assert.match(backend, /enrollment\.documents\?\.identity/);
  assert.match(backend, /enrollment\.documents\?\.address/);
});
