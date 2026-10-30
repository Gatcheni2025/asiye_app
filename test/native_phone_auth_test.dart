import 'package:asiye_app/native_phone_auth.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

class TestUser extends Fake implements User {
  TestUser(this.uid, {this.phoneNumber});
  @override
  final String uid;
  @override
  String? phoneNumber;
  int links = 0;
  FirebaseAuthException? linkError;
  @override
  Future<void> reload() async {}
  @override
  Future<UserCredential> linkWithCredential(AuthCredential credential) async {
    links++;
    if (linkError != null) throw linkError!;
    phoneNumber = '+27821234567';
    return TestCredential(this);
  }
}

class TestCredential extends Fake implements UserCredential {
  TestCredential(this.user);
  @override
  final User user;
}

class TestAuth extends Fake implements FirebaseAuth {
  TestAuth(this.currentUser);
  @override
  User? currentUser;
  int signIns = 0;
  @override
  Future<UserCredential> signInWithCredential(AuthCredential credential) async {
    signIns++;
    currentUser = TestUser('phone-owner', phoneNumber: '+27821234567');
    return TestCredential(currentUser!);
  }
}

void main() {
  final otp = PhoneAuthProvider.credential(
    verificationId: 'test-verification', smsCode: '123456',
  );
  Future<User> complete(TestAuth auth, {String? linkUid}) =>
      completeNativePhoneAuth(
        auth: auth, credential: otp, phone: '+27821234567', linkUid: linkUid,
      );

  test('social OTP preserves the original UID and never signs in as phone owner', () async {
    final user = TestUser('social-owner');
    final auth = TestAuth(user);
    expect((await complete(auth, linkUid: user.uid)).uid, user.uid);
    expect(user.links, 1);
    expect(auth.signIns, 0);
  });

  test('phone collision does not fall back to another account', () async {
    final user = TestUser('social-owner')
      ..linkError = FirebaseAuthException(code: 'credential-already-in-use');
    final auth = TestAuth(user);
    await expectLater(complete(auth, linkUid: user.uid),
      throwsA(isA<FirebaseAuthException>().having((e) => e.code, 'code', 'credential-already-in-use')));
    expect(auth.currentUser?.uid, user.uid);
    expect(auth.signIns, 0);
  });

  test('a changed or missing social session fails before consuming the OTP', () async {
    for (final user in <TestUser?>[null, TestUser('different-owner')]) {
      final auth = TestAuth(user);
      await expectLater(complete(auth, linkUid: 'original-owner'),
        throwsA(isA<FirebaseAuthException>()));
      expect(auth.signIns, 0);
      expect(user?.links ?? 0, 0);
    }
  });

  test('retry after a failed WebView handoff does not consume an accepted OTP again', () async {
    final user = TestUser('social-owner', phoneNumber: '+27821234567');
    final auth = TestAuth(user);
    expect(await complete(auth, linkUid: user.uid), same(user));
    expect(user.links, 0);
    expect(auth.signIns, 0);
  });

  test('ordinary phone authentication signs in without linking a social account', () async {
    final auth = TestAuth(null);
    expect((await complete(auth)).uid, 'phone-owner');
    expect(auth.signIns, 1);
  });
}
