import 'package:asiye_app/native_auth_routing.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const driver = 'file:///android_asset/flutter_assets/assets/driver-v2/login.html';
  const driverHome = 'file:///android_asset/flutter_assets/assets/driver-v2/index.html';
  test('driver intent overrides an older authenticated passenger session', () {
    expect(nativeStartAsset(selectedRole:'driver',sessionRole:'commuter',userId:'old-passenger'),
        'assets/driver-v2/login.html');
    expect(canImportNativeWebSession(pageUrl:driver,webRole:'commuter',
        webUserId:'old-passenger',webAuthUid:'same-user',nativeAuthUid:'same-user'),isFalse);
  });
  test('pending driver verification returns to driver login before a verification ID exists', () {
    final pending = freshDriverPhoneAttempt(role:'driver',linkUid:'social-owner',
        phone:'+27821234567',inProgress:true,startedAt:1000,now:2000);
    expect(pending,isTrue);
    expect(nativeStartAsset(selectedRole:'commuter',sessionRole:'commuter',
        userId:'old-passenger',pendingDriverPhone:pending),'assets/driver-v2/login.html');
  });
  test('native resend keeps the original social owner and cannot become a phone sign-in', () {
    expect(driverPhoneOwner(savedUid:'social-owner',nativeUid:'social-owner',
        selectedRole:'driver',resend:true),'social-owner');
    expect(driverPhoneOwner(savedUid:'social-owner',nativeUid:'social-owner',
        selectedRole:'driver',resend:false),isNull);
    expect(driverPhoneOwner(savedUid:'social-owner',nativeUid:'other-owner',
        selectedRole:'driver',resend:true),isNull);
    expect(driverPhoneOwner(suppliedUid:'social-owner',nativeUid:'social-owner',
        selectedRole:'commuter',resend:false),isNull);
  });
  test('expired, future or unbound OTP state cannot revive a verification screen', () {
    for (final values in [
      {'role':'commuter','uid':'u','start':1000,'now':2000},
      {'role':'driver','uid':'','start':1000,'now':2000},
      {'role':'driver','uid':'u','start':1000,'now':302000},
      {'role':'driver','uid':'u','start':3000,'now':2000},
    ]) {
      expect(freshDriverPhoneAttempt(role:values['role'] as String,linkUid:values['uid'] as String,
          phone:'+27821234567',inProgress:true,startedAt:values['start'] as int,
          now:values['now'] as int),isFalse);
    }
  });
  test('only matching authenticated app dashboards can restore a profile session', () {
    bool check(String url,{String role='driver',String auth='native-owner'}) =>
      canImportNativeWebSession(pageUrl:url,webRole:role,webUserId:'profile',
          webAuthUid:auth,nativeAuthUid:'native-owner');
    expect(check(driverHome),isTrue);
    expect(check(driverHome,role:'commuter'),isFalse);
    expect(check(driverHome,auth:'other-owner'),isFalse);
    expect(check(driver),isFalse);
    expect(check('https://untrusted.example/driver-v2/index.html'),isFalse);
    expect(check('https://asiye-80386.firebaseapp.com/__/auth/handler'),isFalse);
  });
  test('explicit passenger login and completed same-role sessions retain their own routes', () {
    expect(nativeStartAsset(selectedRole:'commuter',sessionRole:'driver',userId:'driver'),
        'assets/passenger-v2/login.html');
    expect(nativeStartAsset(selectedRole:'driver',sessionRole:'driver',userId:'driver'),
        'assets/driver-v2/index.html');
    expect(nativeStartAsset(sessionRole:'commuter',userId:'passenger'),
        'assets/passenger-v2/index.html');
    expect(nativeRoleForAppUrl('https://asiye-80386.web.app/driver-v2/payout.html'),'driver');
    expect(nativeLoginAsset('driver'),'assets/driver-v2/login.html');
  });
}
