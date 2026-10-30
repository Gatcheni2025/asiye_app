import 'package:firebase_auth/firebase_auth.dart';

/// Completes an OTP without replacing the social account being verified.
/// A failed link must never fall back to signing in as the phone's owner.
Future<User> completeNativePhoneAuth({
  required FirebaseAuth auth,
  required PhoneAuthCredential credential,
  required String phone,
  String? linkUid,
}) async {
  User? user = auth.currentUser;
  if (linkUid != null &&
      (linkUid.isEmpty || user == null || user.uid != linkUid)) {
    throw FirebaseAuthException(code: 'phone-link-session-changed');
  }

  // Retry the native-to-WebView handoff after a successful OTP without
  // consuming the same SMS credential again.
  if (user?.phoneNumber != phone) {
    final result = linkUid == null
        ? await auth.signInWithCredential(credential)
        : await user!.linkWithCredential(credential);
    user = result.user;
  }
  if (user == null) {
    throw FirebaseAuthException(code: 'phone-auth-user-missing');
  }
  await user.reload();
  user = auth.currentUser;
  if (user == null ||
      user.phoneNumber != phone ||
      (linkUid != null && user.uid != linkUid)) {
    throw FirebaseAuthException(code: 'phone-link-session-changed');
  }
  return user;
}
