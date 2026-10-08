import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart'; // Gives you access to kIsWeb
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart'; // Needed for AndroidWebViewController
import 'package:geolocator/geolocator.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:share_plus/share_plus.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'dart:async';
import 'dart:convert';

import 'face_scan_screen.dart';
import 'vehicle_camera_screen.dart';
import 'dart:io' show ContentType, HttpClient, HttpHeaders, Platform;

bool _isFirebaseInitialized = false;
final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();

bool get isTest =>
    const bool.fromEnvironment('FLUTTER_TEST', defaultValue: false) ||
    (!kIsWeb && Platform.environment.containsKey('FLUTTER_TEST')) ||
    WidgetsBinding.instance.runtimeType.toString().contains('Test');

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();

  // Show local notification for background data messages
  RemoteNotification? notification = message.notification;
  AndroidNotification? android = message.notification?.android;

  if (notification == null && message.data.isNotEmpty) {
    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      'asiye_danger_channel',
      'High Priority Alerts',
      description: 'Used for new trip requests and urgent alerts.',
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
    );

    await flutterLocalNotificationsPlugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    await flutterLocalNotificationsPlugin.show(
      id: (message.messageId ?? DateTime.now().microsecondsSinceEpoch.toString()).hashCode,
      title: notification?.title ?? message.data['title'] ?? 'Asiye',
      body: notification?.body ?? message.data['message'] ?? message.data['body'] ?? 'New update',
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          channel.id,
          channel.name,
          channelDescription: channel.description,
          importance: Importance.max,
          priority: Priority.high,
          icon: android?.smallIcon ?? '@mipmap/ic_launcher',
          playSound: true,
          enableVibration: true,
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
      payload: jsonEncode(message.data),
    );
  }

  debugPrint("Handling a background message: ${message.messageId}");
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    // FIX 1: Firebase requires options on the Web. We will bypass it for web testing.
    if (!kIsWeb) {
      await Firebase.initializeApp().timeout(const Duration(seconds: 5));
      _isFirebaseInitialized = true;
      FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
    }

    // Initialize Google Sign-In singleton
    await GoogleSignIn.instance.initialize(
      serverClientId: '531902350858-p5bf7u1goohrufm74tgc4v4vvj4fb4j3.apps.googleusercontent.com',
    );
  } catch (e) {
    debugPrint("Initialization failed or timed out: $e");
  }
  
  runApp(const MaterialApp(
    debugShowCheckedModeBanner: false,
    home: AsiyeMainShell(),
  ));
}
class AsiyeMainShell extends StatefulWidget {
  const AsiyeMainShell({super.key});
  @override
  State<AsiyeMainShell> createState() => _AsiyeMainShellState();
}

class _AsiyeMainShellState extends State<AsiyeMainShell> {
  WebViewController? _controller;
  Map<String, dynamic>? _pendingNotification;
  static const MethodChannel _deepLinkChannel =
      MethodChannel('com.asiyeapp.asiye/deeplink');
  static const MethodChannel _contactsChannel =
      MethodChannel('com.asiyeapp.asiye/contacts');
  String? _pendingPaymentReference;
  final FlutterTts _navigationTts = FlutterTts();
  bool _navigationTtsReady = false;
  int? _phoneResendToken;
  String? _phoneVerificationNumber;
  String? _phoneVerificationId;
  bool _showNativeOtp = false;
  bool _nativeOtpBusy = false;
  String? _nativeOtpError;
  final TextEditingController _nativeOtpController = TextEditingController();

  Future<void> _savePendingPhoneAuth({
    String? phone,
    String? verificationId,
    bool clear = false,
  }) async {
    final prefs = await SharedPreferences.getInstance();

    if (clear) {
      _phoneVerificationNumber = null;
      _phoneVerificationId = null;
      _phoneResendToken = null;
      await prefs.remove('pendingPhoneAuthNumber');
      await prefs.remove('pendingPhoneAuthVerificationId');
      await prefs.remove('pendingPhoneAuthInProgress');
      await prefs.remove('pendingPhoneAuthStartedAt');
      return;
    }

    if (phone != null && phone.isNotEmpty) {
      _phoneVerificationNumber = phone;
      await prefs.setString('pendingPhoneAuthNumber', phone);
      await prefs.setBool('pendingPhoneAuthInProgress', true);
      await prefs.setInt(
        'pendingPhoneAuthStartedAt',
        DateTime.now().millisecondsSinceEpoch,
      );
    }

    if (verificationId != null && verificationId.isNotEmpty) {
      _phoneVerificationId = verificationId;
      await prefs.setString(
        'pendingPhoneAuthVerificationId',
        verificationId,
      );
    }
  }

  Future<void> _restorePendingPhoneAuthToWeb() async {
    final prefs = await SharedPreferences.getInstance();
    final phone =
        _phoneVerificationNumber ??
        prefs.getString('pendingPhoneAuthNumber') ??
        '';
    final verificationId =
        _phoneVerificationId ??
        prefs.getString('pendingPhoneAuthVerificationId') ??
        '';
    final inProgress = prefs.getBool('pendingPhoneAuthInProgress') ?? false;

    if (phone.isEmpty && verificationId.isEmpty && !inProgress) return;

    _phoneVerificationNumber =
        phone.isNotEmpty ? phone : _phoneVerificationNumber;
    _phoneVerificationId =
        verificationId.isNotEmpty ? verificationId : _phoneVerificationId;

    final payload = jsonEncode({
      'phone': phone,
      'verificationId': verificationId,
      'inProgress': inProgress,
    });

    await _controller?.runJavaScript(
      "window.onNativePhoneAuthRestored?.($payload);",
    );
  }

  Future<void> _restoreNativePhoneAuthState() async {
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('pendingPhoneAuthNumber') ?? '';
    final verificationId =
        prefs.getString('pendingPhoneAuthVerificationId') ?? '';
    final inProgress =
        prefs.getBool('pendingPhoneAuthInProgress') ?? false;

    if (!inProgress || phone.isEmpty || verificationId.isEmpty) {
      return;
    }

    // Do not resurrect an OTP prompt indefinitely on every fresh app launch.
    // Firebase phone verification codes are short-lived; if the app was not
    // actively returned from verification, reset to the normal login screen.
    final startedAt = prefs.getInt('pendingPhoneAuthStartedAt') ?? 0;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (startedAt <= 0 || now - startedAt > const Duration(minutes: 5).inMilliseconds) {
      await _savePendingPhoneAuth(clear: true);
      return;
    }

    _phoneVerificationNumber = phone;
    _phoneVerificationId = verificationId;

    if (mounted) {
      setState(() {
        _showNativeOtp = true;
        _nativeOtpBusy = false;
        _nativeOtpError = null;
      });
    }
  }

  static const String _nativeAuthExchangeUrl =
      'https://us-central1-asiye-80386.cloudfunctions.net/exchangeNativeAuthSession';

  Future<Map<String, dynamic>> _exchangeNativeFirebaseSession(
    User user,
  ) async {
    final idToken = await user.getIdToken(true);

    if (idToken == null || idToken.isEmpty) {
      throw Exception(
        'Firebase did not return a valid authenticated session.',
      );
    }

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);

    try {
      final request = await client
          .postUrl(Uri.parse(_nativeAuthExchangeUrl))
          .timeout(const Duration(seconds: 20));

      request.headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer $idToken',
      );
      request.headers.contentType = ContentType.json;
      request.write('{}');

      final response = await request.close().timeout(
        const Duration(seconds: 20),
      );
      final responseBody = await response
          .transform(utf8.decoder)
          .join()
          .timeout(const Duration(seconds: 20));

      Map<String, dynamic> payload = <String, dynamic>{};
      if (responseBody.trim().isNotEmpty) {
        final decoded = jsonDecode(responseBody);
        if (decoded is Map) {
          payload = Map<String, dynamic>.from(decoded);
        }
      }

      final customToken =
          payload['customToken']?.toString().trim() ?? '';
      final returnedUid =
          payload['uid']?.toString().trim() ?? '';

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          customToken.isEmpty) {
        final message =
            payload['error']?.toString().trim();
        throw Exception(
          message?.isNotEmpty == true
              ? message
              : 'Unable to create the Asiye login session '
                  '(HTTP ${response.statusCode}).',
        );
      }

      if (returnedUid.isNotEmpty && returnedUid != user.uid) {
        throw Exception(
          'Authentication session mismatch. Please sign in again.',
        );
      }

      return <String, dynamic>{
        'customToken': customToken,
        'uid': user.uid,
      };
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _sendNativeAuthSessionToWeb(
    User user,
    String provider,
  ) async {
    final exchange =
        await _exchangeNativeFirebaseSession(user);

    final payload = <String, dynamic>{
      'provider': provider,
      'customToken': exchange['customToken'],
      'uid': user.uid,
      'phoneNumber': user.phoneNumber ?? '',
      'email': user.email ?? '',
      'displayName': user.displayName ?? '',
      'photoURL': user.photoURL ?? '',
    };

    await _controller?.runJavaScript(
      "window.onNativeAuthSession?.(${jsonEncode(payload)});",
    );
  }

  Future<void> _sendNativeAuthError(
    String provider,
    Object error,
  ) async {
    final message = error.toString().replaceFirst(
      'Exception: ',
      '',
    );

    final payload = <String, dynamic>{
      'provider': provider,
      'message': message,
    };

    await _controller?.runJavaScript(
      "window.onNativeAuthSessionError?.(${jsonEncode(payload)});",
    );
  }

  Future<void> _openNotification(Map<String, dynamic> data) async {
    _pendingNotification = data;
    try {
      final result = await _controller?.runJavaScriptReturningResult("""
        (() => {
          if (typeof window.onNotificationClicked !== 'function') return false;
          window.onNotificationClicked(${jsonEncode(data)});
          return true;
        })()
      """);
      if (result == true || result.toString() == 'true') _pendingNotification = null;
    } catch (error) { debugPrint('Notification deferred until page ready: $error'); }
  }
  StreamSubscription<Position>? _positionSubscription;
  StreamSubscription<String>? _tokenSubscription;
  StreamSubscription<RemoteMessage>? _messageSubscription;
  StreamSubscription<RemoteMessage>? _openedSubscription;
  Timer? _loadingTimeoutTimer;

  @override
  void dispose() {
    _deepLinkChannel.setMethodCallHandler(null);
    _loadingTimeoutTimer?.cancel();
    _positionSubscription?.cancel();
    _tokenSubscription?.cancel();
    _messageSubscription?.cancel();
    _openedSubscription?.cancel();
    _navigationTts.stop();
    _nativeOtpController.dispose();
    super.dispose();
  }

  Future<void> _savePushToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('fcmToken', token);
    await _controller?.runJavaScript("""
      localStorage.setItem('fcmToken', ${jsonEncode(token)});
      if (typeof firebase !== 'undefined' && firebase.apps.length) {
        const uid = localStorage.getItem('userId');
        const type = localStorage.getItem('userType');
        if (uid && type) {
          const node = type === 'driver' ? 'taxis' : type === 'handler' ? 'handlers' : 'commuters';
          firebase.database().ref(node + '/' + uid).update({fcmToken: ${jsonEncode(token)}}).catch(console.warn);
        }
      }
    """);
  }

  final GoogleSignIn _googleSignIn = GoogleSignIn.instance;

  bool _isLoading = true;

  Widget _buildNativePreloader() {
    return Container(
      width: double.infinity,
      height: double.infinity,
      decoration: const BoxDecoration(
        color: Colors.white,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 100,
            height: 100,
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.blueAccent.withValues(alpha: 0.2),
                  blurRadius: 20,
                  spreadRadius: 5,
                ),
              ],
            ),
            child: Center(
              child: Image.asset(
                'assets/data/AsiyeNew.png',
                width: 60,
                errorBuilder: (context, error, stackTrace) => const Icon(Icons.local_taxi, size: 50, color: Colors.blueAccent),
              ),
            ),
          ),
          const SizedBox(height: 30),
          const Text(
            "ASIYE",
            style: TextStyle(
              color: Colors.black87,
              fontSize: 32,
              fontWeight: FontWeight.w900,
              letterSpacing: 2.0,
            ),
          ),
          const SizedBox(height: 40),
          const SizedBox(
            width: 200,
            child: LinearProgressIndicator(
              backgroundColor: Color(0xFFEEEEEE),
              valueColor: AlwaysStoppedAnimation<Color>(Colors.blueAccent),
              minHeight: 4,
              borderRadius: BorderRadius.all(Radius.circular(4)),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _configurePaymentDeepLinks() async {
    _deepLinkChannel.setMethodCallHandler((call) async {
      if (call.method == 'onDeepLink') {
        await _handlePaymentDeepLink(
          call.arguments?.toString(),
        );
      }
    });

    try {
      final initialLink =
          await _deepLinkChannel.invokeMethod<String>('getInitialLink');
      await _handlePaymentDeepLink(initialLink);
    } catch (error) {
      debugPrint('Payment deep-link startup check skipped: $error');
    }
  }

  Future<void> _handlePaymentDeepLink(String? rawLink) async {
    final link = (rawLink ?? '').trim();
    if (link.isEmpty) return;

    final uri = Uri.tryParse(link);
    if (
      uri == null ||
      uri.scheme.toLowerCase() != 'asiye' ||
      uri.host.toLowerCase() != 'payment-complete'
    ) {
      return;
    }

    final reference = (uri.queryParameters['reference'] ?? '').trim();
    if (reference.isEmpty) return;

    _pendingPaymentReference = reference;
    await _deliverPendingPaymentReturn();
  }

  Future<void> _deliverPendingPaymentReturn() async {
    final reference = _pendingPaymentReference;
    final controller = _controller;

    if (reference == null || reference.isEmpty || controller == null) {
      return;
    }

    try {
      final payload = jsonEncode({
        'reference': reference,
      });
      final encodedReference = jsonEncode(reference);

      final delivered =
          await controller.runJavaScriptReturningResult("""
            (() => {
              localStorage.setItem(
                'pendingPaystackReference',
                $encodedReference
              );

              if (typeof window.onAsiyePaymentReturn !== 'function') {
                return false;
              }

              window.onAsiyePaymentReturn($payload);
              return true;
            })()
          """);

      if (
        delivered == true ||
        delivered.toString() == 'true'
      ) {
        _pendingPaymentReference = null;
      }
    } catch (error) {
      debugPrint('Payment return deferred until the wallet page is ready: $error');
    }
  }

  @override
  void initState() {
    super.initState();
    unawaited(_configurePaymentDeepLinks());
    _initializeApp();
    unawaited(_restoreNativePhoneAuthState());
  }

 Future<void> _initializeApp() async {
    if (isTest) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
      return;
    }
 // FIX 2: Prevent the WebViewController from crashing the app on the web.
    if (kIsWeb) {
      debugPrint("Running on Web. Skipping native WebView creation.");
      if (mounted) setState(() => _isLoading = false);
      return; 
    }

    _loadingTimeoutTimer = Timer(const Duration(seconds: 5), () {
      if (mounted && _isLoading) {
        setState(() => _isLoading = false);
      }
    });

    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..setNavigationDelegate(
        NavigationDelegate(
          onWebResourceError: (error) {
            debugPrint("WebView Error: ${error.description}");
            if (mounted) setState(() => _isLoading = false);
          },
          onPageStarted: (url) async {
            if (mounted) setState(() => _isLoading = true);

            // 🚨 CRITICAL FIX: Track Navigation to sync SharedPreferences
            final prefs = await SharedPreferences.getInstance();
            if (url.contains('/driver-v2/') || url.contains('taxi.html')) {
              await prefs.setString('userType', 'driver');
            } else if (url.contains('/passenger-v2/') && !url.contains('login.html')) {
              await prefs.setString('userType', 'commuter');
            } else if (url.contains('handler.html')) {
              await prefs.setString('userType', 'handler');
            }
          },
          onPageFinished: (url) async {
            if (mounted) setState(() => _isLoading = false);

            final prefs = await SharedPreferences.getInstance();

            // 🚨 CRITICAL FIX: Extract Javascript Session if Flutter missed the message
            try {
              final result = await _controller?.runJavaScriptReturningResult("""
                JSON.stringify({
                    uid: localStorage.getItem('userId'),
                    type: localStorage.getItem('userType')
                })
              """);

              if (result != null && result.toString() != "null") {
                String unquoted = result.toString().replaceAll(RegExp(r'^"|"$'), '').replaceAll(r'\"', '"');
                Map<String, dynamic> data = jsonDecode(unquoted);

                if (data['uid'] != null && data['uid'].toString().isNotEmpty) {
                  await prefs.setString('userId', data['uid']);
                }
                if (data['type'] != null && data['type'].toString().isNotEmpty) {
                  await prefs.setString('userType', data['type']);
                }
              }
            } catch(e) {
              debugPrint("Session sync extraction failed: $e");
            }

            final String? userId = prefs.getString('userId');
            final String? userType = prefs.getString('userType');

            if (userId != null && userType != null) {
              final String? fcmToken = prefs.getString('fcmToken');

              // Hard guard to prevent drivers loading index.html and reverting to commuter
              String protectionLogic = "";
              if (url.contains('/passenger-v2/index.html') && userType == 'driver') {
                protectionLogic = "window.location.replace('../driver-v2/index.html');";
              } else if (url.contains('taxi.html') && userType == 'commuter') {
                protectionLogic = "window.location.replace('index.html');";
              }

              _controller?.runJavaScript("""
                localStorage.setItem('userId', '$userId');
                localStorage.setItem('userType', '$userType');
                localStorage.setItem('fcmToken', '${fcmToken ?? ''}');
                
                $protectionLogic

                if (typeof window.checkUserTypeAndRedirect === 'function') {
                    window.checkUserTypeAndRedirect('$userId', '$userType');
                }
              """);
            }
            await _restorePendingPhoneAuthToWeb();
            // login.js can finish initializing just after onPageFinished. Retry
            // restoration so a reCAPTCHA return can never strand the user on
            // the phone-number step after the SMS has already been sent.
            Future.delayed(const Duration(milliseconds: 250), () {
              _restorePendingPhoneAuthToWeb();
            });
            Future.delayed(const Duration(milliseconds: 900), () {
              _restorePendingPhoneAuthToWeb();
            });
            if (_pendingNotification != null) await _openNotification(_pendingNotification!);
            await _deliverPendingPaymentReturn();
            Future.delayed(const Duration(milliseconds: 500), () {
              _deliverPendingPaymentReturn();
            });
          },
          onNavigationRequest: (request) async {
            if (request.url.contains('success.html') || request.url.contains('cancel.html')) {
              final bool isSuccess = request.url.contains('success.html');

              if (isSuccess) {
                final prefs = await SharedPreferences.getInstance();
                await prefs.setBool('isSubscribed', true);
                await prefs.setString('subscriptionStatus', 'active');
              }

              final String startPage = await _determineStartPage();
              _controller?.loadFlutterAsset(startPage);
              return NavigationDecision.prevent;
            }

            if (!request.url.startsWith('http') && !request.url.startsWith('file')) {
              try {
                final uri = Uri.parse(request.url);
                if (await canLaunchUrl(uri)) {
                  await launchUrl(uri);
                }
              } catch (e) {
                debugPrint("URL Launch failed: $e");
              }
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      );

    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setGeolocationEnabled(true);
      platform.setOnPlatformPermissionRequest((request) => request.grant());
      platform.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: (params) async => const GeolocationPermissionsResponse(allow: true, retain: true),
      );

      platform.setOnShowFileSelector((FileSelectorParams params) async {
        try {
          final isImageOnly = params.acceptTypes.any((type) => type.contains('image/'));

          if (isImageOnly) {
            final ImagePicker picker = ImagePicker();
            final String? source = await showModalBottomSheet<String>(
              context: context,
              backgroundColor: const Color(0xFF1c1c1e),
              shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
              builder: (BuildContext bc) {
                return SafeArea(
                  child: Wrap(
                    children: <Widget>[
                      ListTile(
                        leading: const Icon(Icons.photo_library, color: Colors.white),
                        title: const Text('Photo Gallery', style: TextStyle(color: Colors.white)),
                        onTap: () => Navigator.of(context).pop('gallery'),
                      ),
                      ListTile(
                        leading: const Icon(Icons.camera_alt, color: Colors.white),
                        title: const Text('Camera', style: TextStyle(color: Colors.white)),
                        onTap: () => Navigator.of(context).pop('camera'),
                      ),
                    ],
                  ),
                );
              },
            );

            if (source == null) return [];

            final XFile? photo = await picker.pickImage(
              source: source == 'camera' ? ImageSource.camera : ImageSource.gallery,
            );

            if (photo != null) return [Uri.file(photo.path).toString()];
          } else {
            FilePickerResult? result = await FilePicker.pickFiles(
              type: FileType.any,
              allowMultiple: params.mode == FileSelectorMode.openMultiple,
            );

            if (result != null && result.files.single.path != null) {
              return [Uri.file(result.files.single.path!).toString()];
            }
          }
        } catch (e) {
          debugPrint("File selection error: $e");
        }
        return [];
      });
    }

    await controller.addJavaScriptChannel('Android', onMessageReceived: (m) => _handleJsCalls(m.message));
    await controller.addJavaScriptChannel('Asiye', onMessageReceived: (m) => _handleJsCalls(m.message));
    await controller.addJavaScriptChannel('AndroidNav', onMessageReceived: (m) => _handleNavCalls(m.message));

    if (mounted) {
      setState(() {
        _controller = controller;
      });
    }

    try {
      final startPage = await _determineStartPage();
      await controller.loadFlutterAsset(startPage).timeout(
        const Duration(seconds: 3),
        onTimeout: () {
          debugPrint("Asset load timed out, showing webview anyway.");
        },
      );
    } catch (e) {
      debugPrint("Initial load error: $e");
      await controller.loadFlutterAsset('assets/passenger-v2/login.html').catchError((_) => null);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }

    _runBackgroundInitialization();
  }

  Future<void> _runBackgroundInitialization() async {
    try { await _setupNotifications(); } catch (e) { debugPrint("Notif Init Fail: $e"); }
    try { await _requestPermissions(); } catch (e) { debugPrint("Perm Init Fail: $e"); }
  }

  Future<void> _setupNotifications() async {
    if (!_isFirebaseInitialized) return;

    const AndroidInitializationSettings initializationSettingsAndroid =
        AndroidInitializationSettings('@mipmap/ic_launcher');

    const DarwinInitializationSettings initializationSettingsDarwin =
        DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    const InitializationSettings initializationSettings = InitializationSettings(
      android: initializationSettingsAndroid,
      iOS: initializationSettingsDarwin,
    );

    await flutterLocalNotificationsPlugin.initialize(
      settings: initializationSettings,
      onDidReceiveNotificationResponse: (NotificationResponse details) {
        if (details.payload != null) {
          try {
            final data = jsonDecode(details.payload!);
            if (data is Map<String, dynamic>) _openNotification(data);
          } catch (_) { _openNotification({'message': details.payload}); }
        }
      },
    );

    FirebaseMessaging messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      'asiye_danger_channel',
      'High Priority Alerts',
      description: 'Used for new trip requests and urgent alerts.',
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
    );

    await flutterLocalNotificationsPlugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    _tokenSubscription = messaging.onTokenRefresh.listen((token) {
      _savePushToken(token).catchError((Object error) { debugPrint('Push token refresh failed: $error'); });
    });
    _messageSubscription = FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      RemoteNotification? notification = message.notification;
      AndroidNotification? android = message.notification?.android;

      flutterLocalNotificationsPlugin.show(
        id: (message.messageId ?? DateTime.now().microsecondsSinceEpoch.toString()).hashCode,
        title: notification?.title ?? message.data['title'] ?? 'Asiye',
        body: notification?.body ?? message.data['message'] ?? message.data['body'] ?? 'New update',
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            channel.id,
            channel.name,
            channelDescription: channel.description,
            importance: Importance.max,
            priority: Priority.high,
            icon: android?.smallIcon ?? '@mipmap/ic_launcher',
            playSound: true,
            enableVibration: true,
          ),
          iOS: const DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: true,
          ),
        ),
        payload: jsonEncode(message.data),
      );

      _controller?.runJavaScript("if(typeof window.onPushNotificationReceived === 'function') { window.onPushNotificationReceived(${jsonEncode(message.data)}); }");
    });

    _openedSubscription = FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      _openNotification(message.data);
    });

    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) await _openNotification(initialMessage.data);
    final launch = await flutterLocalNotificationsPlugin.getNotificationAppLaunchDetails();
    final payload = launch?.notificationResponse?.payload;
    if (launch?.didNotificationLaunchApp == true && payload != null) {
      try {
        final data = jsonDecode(payload);
        if (data is Map<String, dynamic>) await _openNotification(data);
      } catch (_) { /* Ignore malformed legacy notification payloads. */ }
    }

    String? token;
    try {
      token = await FirebaseMessaging.instance.getToken().timeout(const Duration(seconds: 10));
      if (token != null) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('fcmToken', token);

        _controller?.runJavaScript("""
            localStorage.setItem('fcmToken', '$token');
            if (typeof firebase !== 'undefined' && firebase.database) {
                const uid = localStorage.getItem('userId');
                const type = localStorage.getItem('userType');
                if (uid && type) {
                    const node = (type === 'driver' || type === 'handler') ? (type === 'handler' ? 'handlers' : 'taxis') : 'commuters';
                    firebase.database().ref(node + '/' + uid).update({ fcmToken: '$token' });
                }
            }
        """);
      }
    } catch (e) {
      debugPrint("FCM Token fetch failed: $e");
    }
  }

  Future<void> _requestPermissions() async {
    try {
      await [
        Permission.location,
        Permission.locationWhenInUse,
        Permission.camera,
        Permission.notification,
        Permission.photos,
      ].request();
    } catch (e) {
      debugPrint('Permission request failed: $e');
    }
  }

  Future<String> _determineStartPage() async {
    final prefs = await SharedPreferences.getInstance();
    final String? userType = prefs.getString('userType');

    if (userType != null) {
      switch (userType) {
        case 'driver': return 'assets/driver-v2/index.html';
        case 'rank_manager': return 'assets/taxiRank.html';
        case 'handler': return 'assets/handler.html';
        case 'passenger':
        case 'commuter': return 'assets/passenger-v2/index.html';
      }
    }
    return 'assets/passenger-v2/index.html';
  }

  void _handleNavCalls(String message) async {
    try {
      final Map<String, dynamic> data = jsonDecode(message);
      final String action = data['action'] ?? '';

      switch (action) {
        case 'external_nav':
          final String url = data['url'] ?? '';
          if (url.isNotEmpty) {
            final uri = Uri.parse(url);
            if (await canLaunchUrl(uri)) {
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            }
          }
          break;
        case 'map_intent':
          final double lat = data['lat'] ?? 0.0;
          final double lng = data['lng'] ?? 0.0;
          final String query = Uri.encodeComponent(data['address'] ?? '');
          final String googleMapsUrl = "https://www.google.com/maps/search/?api=1&query=$lat,$lng";
          final String appleMapsUrl = "https://maps.apple.com/?q=$query&ll=$lat,$lng";

          if (await canLaunchUrl(Uri.parse(googleMapsUrl))) {
            await launchUrl(Uri.parse(googleMapsUrl), mode: LaunchMode.externalApplication);
          } else if (await canLaunchUrl(Uri.parse(appleMapsUrl))) {
            await launchUrl(Uri.parse(appleMapsUrl), mode: LaunchMode.externalApplication);
          }
          break;
        case 'dial':
          final String phone = data['phone'] ?? '';
          if (phone.isNotEmpty) {
            final uri = Uri.parse("tel:$phone");
            if (await canLaunchUrl(uri)) {
              await launchUrl(uri);
            }
          }
          break;
        case 'whatsapp':
          final String phone = data['phone'] ?? '';
          final String text = Uri.encodeComponent(data['text'] ?? '');

          final String appUrl = phone.isNotEmpty
              ? "whatsapp://send?phone=$phone&text=$text"
              : "whatsapp://send?text=$text";

          final String webUrl = phone.isNotEmpty
              ? "https://wa.me/$phone?text=$text"
              : "https://api.whatsapp.com/send?text=$text";

          try {
            if (await canLaunchUrl(Uri.parse(appUrl))) {
              await launchUrl(Uri.parse(appUrl), mode: LaunchMode.externalApplication);
            } else {
              await launchUrl(Uri.parse(webUrl), mode: LaunchMode.externalApplication);
            }
          } catch (e) {
            debugPrint('Unable to open share link: $e');
          }
          break;
      }
    } catch (e) {
      debugPrint('Native share request failed: $e');
    }
  }

  Future<void> _pickTrustedContact() async {
    try {
      var permission =
          await Permission.contacts.status;

      if (!permission.isGranted) {
        permission =
            await Permission.contacts.request();
      }

      if (!permission.isGranted) {
        final message =
            permission.isPermanentlyDenied
                ? 'Contacts permission is disabled. Enable Contacts for Asiye in Settings and try again.'
                : 'Contacts permission is required to choose a trusted person.';

        await _controller?.runJavaScript(
          "window.onNativeContactPickError?.(${jsonEncode(message)});",
        );
        return;
      }

      final result =
          await _contactsChannel.invokeMethod<dynamic>('pickContact');

      if (result == null) {
        await _controller?.runJavaScript(
          "window.onNativeContactPickError?.('cancelled');",
        );
        return;
      }

      final contact =
          Map<String, dynamic>.from(
        (result as Map).map(
          (key, value) => MapEntry(
            key.toString(),
            value,
          ),
        ),
      );

      await _controller?.runJavaScript(
        "window.onNativeContactPicked?.(${jsonEncode(contact)});",
      );
    } catch (error) {
      debugPrint('Native contact picker failed: $error');

      await _controller?.runJavaScript(
        "window.onNativeContactPickError?.(${jsonEncode(error.toString())});",
      );
    }
  }

  void _handleJsCalls(String message) async {
    try {
      if (message == "triggerGoogleSignIn" || message == "startGoogleSignIn") {
        await _signInWithGoogle();
      } else if (message == "triggerAppleSignIn" || message == "startAppleSignIn") {
        await _signInWithApple();
      } else if (message == "performLogout") {
        _performLogout();
      } else if (message.startsWith("getCurrentLocation") || message.startsWith("requestLocation")) {
        bool highAccuracy = !message.contains("accuracy:low");
        _getCurrentLocation(highAccuracy: highAccuracy);
      } else if (message == "startLocationWatch") {
        _startLocationWatch();
      } else if (message == "stopLocationWatch") {
        _stopLocationWatch();
      } else {
        try {
          final Map<String, dynamic> data = jsonDecode(message);
          final action = data['action'];
          if (action == 'startPhoneSignIn') {
            await _startPhoneSignIn(data['phone']?.toString() ?? '');
          }
          else if (action == 'resendPhoneOtp') {
            await _startPhoneSignIn(
              data['phone']?.toString() ?? '',
              forceResend: true,
            );
          }
          else if (action == 'verifyPhoneOtp') {
            await _verifyPhoneOtp(data['verificationId']?.toString() ?? '', data['code']?.toString() ?? '');
          }
          else if (action == 'onUserLoggedIn' || action == 'onSignupSuccess') {
            await _saveSessionAndRedirect(data['uid'], data['type']);
          }
          else if (action == 'showNotification') {
            _triggerSystemNotification(data['title'] ?? 'Asiye', data['message'] ?? 'New update', data['payload']);
          }
          else if (action == 'speakNavigation') {
            await _speakNavigation(
              data['text']?.toString() ?? '',
            );
          }
          else if (action == 'stopNavigationVoice') {
            await _stopNavigationVoice();
          }
          else if (action == 'hidePreloader') {
            if (mounted) setState(() => _isLoading = false);
          }
          else if (action == 'captureFacePhoto') {
            await _captureFacePhoto(
              data['purpose']?.toString() ?? 'profile',
            );
          }
          else if (action == 'pickContact') {
            await _pickTrustedContact();
          }
          else if (action == 'shareTrip') {
            await _shareTripRequired(
              data['text']?.toString() ?? '',
            );
          }
          else if (action == 'share') {
            final String text = data['text'] ?? '';
            if (text.isNotEmpty) {
              Share.share(text);
            }
          }
        } catch (e) {
          debugPrint('Unable to decode native WebView action: $e');
        }
      }
    } catch (e) {
      debugPrint('Native WebView bridge failed: $e');
    }
  }

  Future<void> _startPhoneSignIn(
    String phone, {
    bool forceResend = false,
  }) async {
    final cleanPhone = phone.trim();
    if (cleanPhone.isEmpty) {
      _controller?.runJavaScript("window.onNativePhoneAuthError?.('Enter a valid phone number.');");
      return;
    }

    if (_phoneVerificationNumber != cleanPhone) {
      _phoneVerificationNumber = cleanPhone;
      _phoneResendToken = null;
      _phoneVerificationId = null;
    }

    try {
      final existingUser =
          FirebaseAuth.instance.currentUser;

      if (existingUser != null &&
          existingUser.phoneNumber != cleanPhone) {
        await FirebaseAuth.instance.signOut();
      }

      if (mounted) {
        setState(() {
          _showNativeOtp = false;
          _nativeOtpBusy = false;
          _nativeOtpError = null;
        });
      }

      await _savePendingPhoneAuth(phone: cleanPhone);

      // Recover cleanly if Firebase initialization timed out during app startup.
      // Phone authentication must always use the native Firebase SDK in the
      // installed app; the WebView must never be responsible for app verification.
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      _isFirebaseInitialized = Firebase.apps.isNotEmpty;

      await FirebaseAuth.instance.verifyPhoneNumber(
        phoneNumber: cleanPhone,
        timeout: const Duration(seconds: 60),
        forceResendingToken: forceResend ? _phoneResendToken : null,
        verificationCompleted: (PhoneAuthCredential credential) async {
          try {
            final result =
                await FirebaseAuth.instance.signInWithCredential(
              credential,
            );
            final user = result.user;
            if (user == null) {
              throw Exception(
                'Phone authentication did not return a user.',
              );
            }

            await _sendNativeAuthSessionToWeb(
              user,
              'phone',
            );
            await _savePendingPhoneAuth(clear: true);

            if (mounted) {
              setState(() {
                _showNativeOtp = false;
                _nativeOtpBusy = false;
                _nativeOtpError = null;
              });
            }
          } catch (error) {
            await _sendNativeAuthError('phone', error);
          }
        },
        verificationFailed: (FirebaseAuthException error) async {
          final message =
              error.message ?? error.code;

          await _savePendingPhoneAuth(
            clear: true,
          );

          if (mounted) {
            setState(() {
              _showNativeOtp = false;
              _nativeOtpBusy = false;
              _nativeOtpError = message;
            });
          }

          await _sendNativeAuthError(
            'phone',
            Exception(message),
          );
        },
        codeSent: (String verificationId, int? resendToken) async {
          _phoneVerificationNumber = cleanPhone;
          _phoneVerificationId = verificationId;
          _phoneResendToken = resendToken;

          // reCAPTCHA may recreate/resume the Activity and therefore reload the
          // WebView. Persist the verification ID before touching the web UI.
          await _savePendingPhoneAuth(
            phone: cleanPhone,
            verificationId: verificationId,
          );

          if (mounted) {
            setState(() {
              _showNativeOtp = true;
              _nativeOtpBusy = false;
              _nativeOtpError = null;
              _nativeOtpController.clear();
            });
          }

          await _controller?.runJavaScript(
            "window.onNativePhoneCodeSent?.(${jsonEncode(verificationId)}, ${jsonEncode(cleanPhone)});",
          );

          // Keep the WebView in sync as a fallback, but the OTP entry itself is
          // now native so a reCAPTCHA/WebView reload cannot hide it.
          await _restorePendingPhoneAuthToWeb();
        },
        codeAutoRetrievalTimeout: (String verificationId) {
          _phoneVerificationId = verificationId;
          unawaited(
            _savePendingPhoneAuth(
              phone: cleanPhone,
              verificationId: verificationId,
            ),
          );
          _controller?.runJavaScript(
            "window.onNativePhoneCodeTimeout?.(${jsonEncode(verificationId)}, ${jsonEncode(cleanPhone)});",
          );
        },
      );
    } catch (e) {
      _controller?.runJavaScript("window.onNativePhoneAuthError?.(${jsonEncode(e.toString())});");
    }
  }

  Future<void> _verifyPhoneOtp(
    String verificationId,
    String code,
  ) async {
    try {
      if (mounted) {
        setState(() {
          _nativeOtpBusy = true;
          _nativeOtpError = null;
        });
      }

      final digits =
          code.replaceAll(RegExp(r'[^0-9]'), '');
      final prefs =
          await SharedPreferences.getInstance();
      final resolvedVerificationId =
          verificationId.isNotEmpty
              ? verificationId
              : (_phoneVerificationId ??
                  prefs.getString(
                    'pendingPhoneAuthVerificationId',
                  ) ??
                  '');

      if (resolvedVerificationId.isEmpty ||
          digits.length != 6) {
        throw Exception(
          'Enter the 6-digit verification code.',
        );
      }

      User? user = FirebaseAuth.instance.currentUser;

      // If the OTP was already accepted natively but the WebView handoff
      // failed, retry only the session exchange instead of consuming the
      // verification code a second time.
      if (user == null ||
          (_phoneVerificationNumber != null &&
              user.phoneNumber != _phoneVerificationNumber)) {
        final credential =
            PhoneAuthProvider.credential(
          verificationId: resolvedVerificationId,
          smsCode: digits,
        );

        final result =
            await FirebaseAuth.instance.signInWithCredential(
          credential,
        );
        user = result.user;
      }

      if (user == null) {
        throw Exception(
          'Phone authentication did not return a user.',
        );
      }

      await _sendNativeAuthSessionToWeb(
        user,
        'phone',
      );
      await _savePendingPhoneAuth(clear: true);

      if (mounted) {
        setState(() {
          _nativeOtpBusy = false;
          _nativeOtpError = null;
          _showNativeOtp = false;
        });

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'OTP verified successfully. Signing you in...',
            ),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (error) {
      final message = error
          .toString()
          .replaceFirst(
            'Exception: ',
            '',
          );

      if (mounted) {
        setState(() {
          _nativeOtpBusy = false;
          _nativeOtpError = message;
          _showNativeOtp = true;
        });
      }

      await _sendNativeAuthError(
        'phone',
        error,
      );
    }
  }

  Future<void> _captureFacePhoto(String purpose) async {
    try {
      final cameraStatus = await Permission.camera.request();
      if (!cameraStatus.isGranted) {
        final message = cameraStatus.isPermanentlyDenied
            ? 'Camera permission is disabled. Enable Camera for Asiye in Settings and try again.'
            : 'Camera permission is required to capture your profile picture.';
        _controller?.runJavaScript(
          "window.onNativeFaceCaptureError?.(${jsonEncode(message)});",
        );
        return;
      }

      final normalizedPurpose = purpose.toLowerCase();
      final isVehicle =
          normalizedPurpose.contains('vehicle') ||
          normalizedPurpose.contains('car') ||
          normalizedPurpose.contains('licence') ||
          normalizedPurpose.contains('license') ||
          normalizedPurpose.contains('document');

      XFile? photo;

      if (!isVehicle) {
        final title = normalizedPurpose.contains('driver')
            ? 'Driver live face scan'
            : 'Passenger live face scan';

        final path = await Navigator.of(context).push<String>(
          MaterialPageRoute<String>(
            fullscreenDialog: true,
            builder: (_) => AsiyeLiveFaceScanScreen(title: title),
          ),
        );

        if (path == null || path.isEmpty) {
          _controller?.runJavaScript(
            "window.onNativeFaceCaptureError?.('cancelled');",
          );
          return;
        }

        photo = XFile(path);
      } else if (normalizedPurpose == 'driver-vehicle') {
        // A shutter press closes the in-app car camera and resumes the
        // existing driver Vehicle page without an external camera screen.
        final path = await Navigator.of(context).push<String>(
          MaterialPageRoute<String>(
            fullscreenDialog: true,
            builder: (_) => const AsiyeVehicleCameraScreen(),
          ),
        );
        if (path == null || path.isEmpty) {
          await _controller?.runJavaScript(
            "window.onNativeFaceCaptureError?.('cancelled');",
          );
          return;
        }
        photo = XFile(path);
      } else {
        final picker = ImagePicker();
        photo = await picker.pickImage(
          source: ImageSource.camera,
          preferredCameraDevice: CameraDevice.rear,
          imageQuality: 65,
          maxWidth: 1280,
          maxHeight: 1280,
        );
      }

      if (photo == null) {
        _controller?.runJavaScript(
          "window.onNativeFaceCaptureError?.('cancelled');",
        );
        return;
      }

      final bytes = await photo.readAsBytes();
      if (bytes.isEmpty) {
        throw Exception('Camera returned an empty image.');
      }

      final mime =
          (photo.mimeType != null && photo.mimeType!.startsWith('image/'))
              ? photo.mimeType!
              : 'image/jpeg';

      final payload = {
        'purpose': purpose,
        'dataUrl': 'data:$mime;base64,${base64Encode(bytes)}',
        'liveCapture': !isVehicle,
        'checks': !isVehicle
            ? ['single_face', 'head_movement', 'smile']
            : <String>[],
      };

      _controller?.runJavaScript(
        "window.onNativeFaceCaptureSuccess?.(${jsonEncode(payload)});",
      );
    } catch (e) {
      debugPrint('Native camera/face scan failed: $e');
      _controller?.runJavaScript(
        "window.onNativeFaceCaptureError?.(${jsonEncode(e.toString())});",
      );
    }
  }

  Future<void> _shareTripRequired(String text) async {
    if (text.trim().isEmpty) {
      _controller?.runJavaScript(
        "window.onNativeTripShareResult?.({shared:false,error:'Trip details are unavailable.'});",
      );
      return;
    }

    try {
      final result = await Share.share(text);
      final shared =
          result.status == ShareResultStatus.success;

      _controller?.runJavaScript(
        "window.onNativeTripShareResult?.(${jsonEncode({
          'shared': shared,
          'status': result.status.name,
        })});",
      );
    } catch (e) {
      _controller?.runJavaScript(
        "window.onNativeTripShareResult?.(${jsonEncode({
          'shared': false,
          'error': e.toString(),
        })});",
      );
    }
  }

  Future<void> _speakNavigation(String text) async {
    final announcement = text.trim();
    if (announcement.isEmpty) return;

    try {
      if (!_navigationTtsReady) {
        await _navigationTts.setLanguage('en-ZA');
        await _navigationTts.setSpeechRate(0.48);
        await _navigationTts.setVolume(1.0);
        await _navigationTts.setPitch(1.0);
        _navigationTtsReady = true;
      }

      await _navigationTts.stop();
      await _navigationTts.speak(announcement);
    } catch (error) {
      debugPrint('Navigation TTS failed: $error');
    }
  }

  Future<void> _stopNavigationVoice() async {
    try {
      await _navigationTts.stop();
    } catch (error) {
      debugPrint('Unable to stop navigation TTS: $error');
    }
  }

  Future<void> _triggerSystemNotification(String? title, String? body, String? payload) async {
    const AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
      'asiye_danger_channel',
      'Asiye Alerts',
      importance: Importance.max,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
      playSound: true,
      enableVibration: true,
    );

    NotificationDetails platformDetails = const NotificationDetails(
      android: androidDetails,
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      ),
    );

    await flutterLocalNotificationsPlugin.show(
      id: DateTime.now().millisecond,
      title: title,
      body: body,
      notificationDetails: platformDetails,
      payload: payload,
    );
  }

  Future<void> _performLogout() async {
    final prefs =
        await SharedPreferences.getInstance();

    try {
      await FirebaseAuth.instance.signOut();
    } catch (_) {}

    try {
      await _googleSignIn.signOut();
    } catch (_) {}

    await _savePendingPhoneAuth(clear: true);
    await prefs.clear();

    _nativeOtpController.clear();

    if (mounted) {
      setState(() {
        _showNativeOtp = false;
        _nativeOtpBusy = false;
        _nativeOtpError = null;
      });
    }

    await _controller?.runJavaScript(
      "localStorage.clear(); sessionStorage.clear();",
    );
    await _controller?.loadFlutterAsset(
      'assets/passenger-v2/login.html',
    );
  }

  Future<void> _getCurrentLocation({bool highAccuracy = true}) async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.deniedForever) {
        _controller?.runJavaScript("if(typeof window.onNativeLocationError === 'function') { window.onNativeLocationError('Permission denied forever'); }");
        return;
      }

      LocationSettings locationSettings = LocationSettings(
        accuracy: highAccuracy ? LocationAccuracy.high : LocationAccuracy.low,
        timeLimit: const Duration(seconds: 10),
      );

      Position position = await Geolocator.getCurrentPosition(locationSettings: locationSettings);

      final Map<String, dynamic> locData = {
        "latitude": position.latitude,
        "longitude": position.longitude,
        "accuracy": position.accuracy,
        "heading": position.heading,
        "speed": position.speed,
      };

      _controller?.runJavaScript("if(typeof window.onNativeLocationSuccess === 'function') { window.onNativeLocationSuccess(${jsonEncode(locData)}); }");
    } catch (e) {
      _controller?.runJavaScript("if(typeof window.onNativeLocationError === 'function') { window.onNativeLocationError('${e.toString()}'); }");
    }
  }

  void _startLocationWatch() async {
    _positionSubscription?.cancel();
    _positionSubscription = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 5),
    ).listen((Position position) {
      final Map<String, dynamic> locData = {
        "latitude": position.latitude,
        "longitude": position.longitude,
        "accuracy": position.accuracy,
        "heading": position.heading,
        "speed": position.speed,
      };
      _controller?.runJavaScript("if(typeof window.onNativeLocationUpdate === 'function') { window.onNativeLocationUpdate(${jsonEncode(locData)}); }");
    });
  }

  void _stopLocationWatch() {
    _positionSubscription?.cancel();
    _positionSubscription = null;
  }

  Future<void> _saveSessionAndRedirect(String uid, String type) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('userId', uid);
    await prefs.setString('userType', type);

    String target = 'assets/passenger-v2/index.html';
    if (type == 'driver') target = 'assets/driver-v2/index.html';
    if (type == 'handler') target = 'assets/handler.html';
    if (type == 'rank_manager') target = 'assets/taxiRank.html';
    if (type == 'commuter' || type == 'passenger') target = 'assets/passenger-v2/index.html';

    _controller?.loadFlutterAsset(target);
  }

  Future<void> _signInWithGoogle() async {
    try {
      try {
        await FirebaseAuth.instance.signOut();
      } catch (_) {}

      try {
        await _googleSignIn.signOut();
      } catch (_) {}

      final account =
          await _googleSignIn.authenticate();
      final auth =
          account.authentication;
      final idToken =
          auth.idToken;

      if (idToken == null ||
          idToken.isEmpty) {
        throw Exception(
          'Google did not return a valid identity token.',
        );
      }

      final credential =
          GoogleAuthProvider.credential(
        idToken: idToken,
      );

      final result =
          await FirebaseAuth.instance.signInWithCredential(
        credential,
      );
      final user =
          result.user;

      if (user == null) {
        throw Exception(
          'Google authentication did not return a user.',
        );
      }

      await _sendNativeAuthSessionToWeb(
        user,
        'google',
      );
    } catch (error) {
      final lower =
          error.toString().toLowerCase();

      if (lower.contains('cancelled') ||
          lower.contains('canceled')) {
        await _sendNativeAuthError(
          'google',
          Exception('Cancelled'),
        );
        return;
      }

      await _sendNativeAuthError(
        'google',
        error,
      );
    }
  }

  Future<void> _signInWithApple() async {
    try {
      try {
        await FirebaseAuth.instance.signOut();
      } catch (_) {}

      final provider =
          AppleAuthProvider()
            ..addScope('email')
            ..addScope('name');

      final result =
          await FirebaseAuth.instance.signInWithProvider(
        provider,
      );
      final user =
          result.user;

      if (user == null) {
        throw Exception(
          'Apple authentication did not return a user.',
        );
      }

      await _sendNativeAuthSessionToWeb(
        user,
        'apple',
      );
    } catch (error) {
      final lower =
          error.toString().toLowerCase();

      if (lower.contains('cancelled') ||
          lower.contains('canceled')) {
        await _sendNativeAuthError(
          'apple',
          Exception('Cancelled'),
        );
        return;
      }

      await _sendNativeAuthError(
        'apple',
        error,
      );
    }
  }

  Widget _buildNativeOtpCard() {
    final phone = _phoneVerificationNumber ?? '';
    return Positioned.fill(
      child: Material(
        color: Colors.black54,
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 430),
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('Enter verification code',
                      style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Colors.black)),
                    const SizedBox(height: 8),
                    Text('We sent a 6-digit OTP to $phone',
                      style: const TextStyle(fontSize: 15, color: Colors.black54)),
                    const SizedBox(height: 22),
                    TextField(
                      controller: _nativeOtpController,
                      autofocus: true,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: 8),
                      decoration: InputDecoration(
                        counterText: '',
                        hintText: '000000',
                        errorText: _nativeOtpError,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                      onChanged: (value) {
                        final digits = value.replaceAll(RegExp(r'[^0-9]'), '');
                        if (digits != value) {
                          _nativeOtpController.value = TextEditingValue(
                            text: digits,
                            selection: TextSelection.collapsed(offset: digits.length),
                          );
                        }
                      },
                      onSubmitted: (_) {
                        if (!_nativeOtpBusy && _nativeOtpController.text.length == 6) {
                          _verifyPhoneOtp('', _nativeOtpController.text);
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 56,
                      child: FilledButton(
                        onPressed: _nativeOtpBusy ? null : () {
                          _verifyPhoneOtp('', _nativeOtpController.text.trim());
                        },
                        style: FilledButton.styleFrom(backgroundColor: Colors.black),
                        child: _nativeOtpBusy
                          ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Verify & sign in', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                      ),
                    ),
                    TextButton(
                      onPressed: _nativeOtpBusy ? null : () {
                        if (_phoneVerificationNumber != null) {
                          _startPhoneSignIn(_phoneVerificationNumber!, forceResend: true);
                        }
                      },
                      child: const Text('Resend code'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          if (_controller != null) WebViewWidget(controller: _controller!),
          if (_controller == null || _isLoading) _buildNativePreloader(),
          if (_showNativeOtp) _buildNativeOtpCard(),
        ],
      ),
    );
  }
}
