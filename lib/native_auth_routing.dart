// UI routing only. Firebase/server authorization remains authoritative.
String? canonicalNativeRole(String? value) => switch (value) {
  'driver' => 'driver',
  'passenger' || 'commuter' => 'commuter',
  'handler' => 'handler',
  'rank_manager' => 'rank_manager',
  _ => null,
};

String? nativeRoleForAppUrl(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null) return null;
  final path = uri.path;
  final localAsset = uri.scheme == 'file' && path.contains('/flutter_assets/assets/');
  final hostedApp = uri.scheme == 'https' && {
    'asiye-80386.web.app', 'asiye-80386.firebaseapp.com',
    'asiye.cloud', 'www.asiye.cloud', 'appassets.androidplatform.net',
  }.contains(uri.host);
  if (!localAsset && !hostedApp) return null;
  if (path.contains('/driver-v2/') || path.endsWith('/taxi.html')) return 'driver';
  if (path.contains('/passenger-v2/')) return 'commuter';
  if (path.endsWith('/handler.html')) return 'handler';
  if (path.endsWith('/taxiRank.html')) return 'rank_manager';
  return null;
}

bool nativeLoginPage(String url) => Uri.tryParse(url)?.path.endsWith('/login.html') == true;
String? driverPhoneOwner({String? suppliedUid,String? savedUid,String? nativeUid,
    String? selectedRole,required bool resend}) {
  final expected = suppliedUid ?? (resend ? savedUid : null);
  return selectedRole == 'driver' && expected != null && expected.isNotEmpty &&
      expected == nativeUid ? expected : null;
}
String nativeLoginAsset(String? role) => canonicalNativeRole(role) == 'driver'
    ? 'assets/driver-v2/login.html' : 'assets/passenger-v2/login.html';
String nativeHomeAsset(String? role) => switch (canonicalNativeRole(role)) {
  'driver' => 'assets/driver-v2/index.html',
  'handler' => 'assets/handler.html',
  'rank_manager' => 'assets/taxiRank.html',
  _ => 'assets/passenger-v2/index.html',
};

bool freshDriverPhoneAttempt({
  required String? role, required String? linkUid, required String? phone,
  required bool inProgress, required int startedAt, required int now,
}) => role == 'driver' && inProgress && (linkUid?.isNotEmpty ?? false) &&
    (phone?.isNotEmpty ?? false) && startedAt > 0 && now >= startedAt &&
    now - startedAt <= const Duration(minutes: 5).inMilliseconds;

String nativeStartAsset({
  String? selectedRole, String? sessionRole, String? userId,
  bool pendingDriverPhone = false,
}) {
  if (pendingDriverPhone) return nativeLoginAsset('driver');
  final selected = canonicalNativeRole(selectedRole), session = canonicalNativeRole(sessionRole);
  if (selected == 'handler' || selected == 'rank_manager') return nativeHomeAsset(selected);
  if (selected != null && selected != session) return nativeLoginAsset(selected);
  if (session != null && (userId?.isNotEmpty ?? false)) return nativeHomeAsset(session);
  if (selected == 'driver' || session == 'driver') return nativeLoginAsset('driver');
  return nativeHomeAsset(session);
}

bool canImportNativeWebSession({
  required String pageUrl, required String? webRole,
  required String? webUserId, required String? webAuthUid,
  required String? nativeAuthUid,
}) => !nativeLoginPage(pageUrl) && nativeRoleForAppUrl(pageUrl) != null &&
    nativeRoleForAppUrl(pageUrl) == canonicalNativeRole(webRole) &&
    (webUserId?.isNotEmpty ?? false) && (nativeAuthUid?.isNotEmpty ?? false) &&
    webAuthUid == nativeAuthUid;
