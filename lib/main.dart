import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart'; // Gives you access to kIsWeb
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
import 'package:package_info_plus/package_info_plus.dart';
import 'package:system_contact_picker/system_contact_picker.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'face_scan_screen.dart';

bool _isFirebaseInitialized = false;
final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();

const bool isTest = bool.fromEnvironment('FLUTTER_TEST', defaultValue: false);

int _compareVersions(String left, String right) {
  final leftParts = left.split('.').map((part) => int.tryParse(part) ?? 0).toList();
  final rightParts = right.split('.').map((part) => int.tryParse(part) ?? 0).toList();
  final length = max(leftParts.length, rightParts.length);

  for (var index = 0; index < length; index++) {
    final leftValue = index < leftParts.length ? leftParts[index] : 0;
    final rightValue = index < rightParts.length ? rightParts[index] : 0;
    if (leftValue != rightValue) return leftValue.compareTo(rightValue);
  }
  return 0;
}

Future<bool> _isAppUpdateRequired(Map<String, dynamic> data) async {
  if (data['type']?.toString() != 'app_update') return false;

  final info = await PackageInfo.fromPlatform();

  if (defaultTargetPlatform == TargetPlatform.iOS) {
    final latestVersion =
        data['latestVersionIos']?.toString() ??
        data['latestVersion']?.toString() ??
        '';
    return latestVersion.isNotEmpty &&
        _compareVersions(info.version, latestVersion) < 0;
  }

  final currentBuild = int.tryParse(info.buildNumber) ?? 0;
  final latestBuild = int.tryParse(
        data['latestBuildAndroid']?.toString() ??
        data['latestBuild']?.toString() ??
        '0',
      ) ??
      0;
  return latestBuild > currentBuild;
}

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();

  if (message.data['type']?.toString() == 'app_update') {
    try {
      if (!await _isAppUpdateRequired(message.data)) {
        debugPrint('Ignoring app update notification: installed version is current.');
        return;
      }
    } catch (error) {
      debugPrint('Unable to compare app update version in background: $error');
    }
  }

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
  final FlutterTts _navigationTts = FlutterTts();
  bool _navigationTtsReady = false;

  Future<void> _openNotification(Map<String, dynamic> data) async {
    if (data['type']?.toString() == 'app_update') {
      await _handleAppReleaseConfig(data, fromNotification: true);
      return;
    }

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
  int? _phoneResendToken;
  String? _phoneVerificationId;
  int? _lastPromptedReleaseBuild;
  String? _lastPromptedReleaseVersion;

  @override
  void dispose() {
    _positionSubscription?.cancel();
    _tokenSubscription?.cancel();
    _messageSubscription?.cancel();
    _openedSubscription?.cancel();
    _navigationTts.stop();
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

  String _currentPlatformName() {
    return defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
  }

  String _selectUpdateUrl(Map<String, dynamic> release) {
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return release['iosUrl']?.toString() ??
          release['updateUrl']?.toString() ??
          '';
    }

    return release['androidUrl']?.toString() ??
        release['updateUrl']?.toString() ??
        'https://play.google.com/store/apps/details?id=com.asiyeapp.asiye';
  }

  bool _readBool(dynamic value) {
    if (value is bool) return value;
    return value?.toString().toLowerCase() == 'true';
  }

  Future<void> _openAppUpdate(Map<String, dynamic> release) async {
    final url = _selectUpdateUrl(release);
    if (url.isEmpty) {
      debugPrint('No update URL configured for ${_currentPlatformName()}.');
      return;
    }

    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _handleAppReleaseConfig(
    Map<String, dynamic> release, {
    bool fromNotification = false,
  }) async {
    try {
      final data = <String, dynamic>{'type': 'app_update', ...release};
      if (!await _isAppUpdateRequired(data)) return;

      final info = await PackageInfo.fromPlatform();
      final latestBuild = int.tryParse(
            release['latestBuildAndroid']?.toString() ??
            release['latestBuild']?.toString() ??
            '0',
          ) ??
          0;
      final latestVersion =
          release['latestVersionIos']?.toString() ??
          release['latestVersion']?.toString() ??
          '';

      if (!fromNotification) {
        if (defaultTargetPlatform == TargetPlatform.iOS) {
          if (_lastPromptedReleaseVersion == latestVersion) return;
          _lastPromptedReleaseVersion = latestVersion;
        } else {
          if (_lastPromptedReleaseBuild == latestBuild) return;
          _lastPromptedReleaseBuild = latestBuild;
        }
      }

      if (!mounted) return;

      final title =
          release['title']?.toString() ??
          'A new Asiye update is available';
      final message =
          release['message']?.toString() ??
          'Update Asiye to get the latest improvements and fixes.';
      final forceUpdate = _readBool(release['forceUpdate']);

      final shouldUpdate = await showDialog<bool>(
        context: context,
        barrierDismissible: !forceUpdate,
        builder: (dialogContext) => AlertDialog(
          title: Text(title),
          content: Text(
            '$message\n\nInstalled: ${info.version}\nLatest: '
            '${latestVersion.isNotEmpty ? latestVersion : 'new version'}',
          ),
          actions: [
            if (!forceUpdate)
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Later'),
              ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Update now'),
            ),
          ],
        ),
      );

      if (shouldUpdate == true) {
        await _openAppUpdate(release);
      }
    } catch (error) {
      debugPrint('App update check failed: $error');
    }
  }

  Future<void> _syncAppVersionAndCheckRelease() async {
    try {
      final info = await PackageInfo.fromPlatform();
      final build = int.tryParse(info.buildNumber) ?? 0;
      final platform = _currentPlatformName();
      final prefs = await SharedPreferences.getInstance();

      await prefs.setString('appVersion', info.version);
      await prefs.setInt('appBuild', build);
      await prefs.setString('appPlatform', platform);

      await _controller?.runJavaScript("""
        (() => {
          const version = ${jsonEncode(info.version)};
          const build = ${jsonEncode(build)};
          const platform = ${jsonEncode(platform)};

          localStorage.setItem('appVersion', version);
          localStorage.setItem('appBuild', String(build));
          localStorage.setItem('appPlatform', platform);

          if (typeof firebase === 'undefined' || !firebase.apps?.length || !firebase.database) {
            return;
          }

          const uid = localStorage.getItem('userId');
          const type = localStorage.getItem('userType');

          if (uid && type) {
            const node =
              type === 'driver'
                ? 'taxis'
                : type === 'handler'
                  ? 'handlers'
                  : 'commuters';

            firebase.database().ref(node + '/' + uid).update({
              appVersion: version,
              appBuild: build,
              appPlatform: platform,
              appVersionUpdatedAt: firebase.database.ServerValue.TIMESTAMP
            }).catch(error => console.warn('App version sync failed', error?.code || error));
          }

          firebase.database().ref('appRelease/current').once('value')
            .then(snapshot => {
              const config = snapshot.val();
              const channel = window.Asiye || window.Android;
              if (!config || !channel || typeof channel.postMessage !== 'function') return;
              channel.postMessage(JSON.stringify({
                action: 'appReleaseConfig',
                config
              }));
            })
            .catch(error => console.warn('App release check failed', error?.code || error));
        })();
      """);
    } catch (error) {
      debugPrint('App version sync failed: $error');
    }
  }

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

  @override
  void initState() {
    super.initState();
    _initializeApp();
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

    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(
        NavigationDelegate(
          onWebResourceError: (error) {
            debugPrint("WebView Error: ${error.description}");
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
            final bool waitsForInteractiveReady =
                url.contains('/passenger-v2/index.html') ||
                url.contains('/driver-v2/index.html');

            /*
             * Main passenger/driver shells keep the native Asiye logo
             * visible until their JS map/UI explicitly sends
             * { action: 'hidePreloader' }. Static/login pages can reveal
             * as soon as WebView reports that the page has finished.
             */
            if (
              !waitsForInteractiveReady &&
              mounted
            ) {
              setState(() => _isLoading = false);
            }

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
            await _syncAppVersionAndCheckRelease();
            if (_pendingNotification != null) await _openNotification(_pendingNotification!);
          },
          onNavigationRequest: (request) async {
            if (request.url.contains('ozowWalletReturn')) {
              final String startPage = await _determineStartPage();
              _controller?.loadFlutterAsset(startPage);
              return NavigationDecision.prevent;
            }

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

    await controller.platform.setOnPlatformPermissionRequest(
      _handleWebViewPermissionRequest,
    );

    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setGeolocationEnabled(true);
      platform.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: (params) async =>
            const GeolocationPermissionsResponse(allow: true, retain: true),
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

            if (source == 'camera' && !await _ensureCameraPermission()) {
              return [];
            }

            final XFile? photo = await picker.pickImage(
              source: source == 'camera' ? ImageSource.camera : ImageSource.gallery,
              imageQuality: 88,
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
    _messageSubscription = FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
      if (message.data['type']?.toString() == 'app_update') {
        try {
          if (!await _isAppUpdateRequired(message.data)) return;
        } catch (error) {
          debugPrint('Foreground app update comparison failed: $error');
        }
      }

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
      final permissions = <Permission>[
        Permission.locationWhenInUse,
      ];

      if (defaultTargetPlatform == TargetPlatform.android) {
        permissions.add(Permission.notification);
      }

      await permissions.request();
    } catch (e) {
      debugPrint('Permission request failed: $e');
    }
  }

  Future<void> _handleWebViewPermissionRequest(
    PlatformWebViewPermissionRequest request,
  ) async {
    final wantsCamera =
        request.types.contains(WebViewPermissionResourceType.camera);
    final wantsMicrophone =
        request.types.contains(WebViewPermissionResourceType.microphone);

    if (wantsCamera && !await _ensureCameraPermission()) {
      await request.deny();
      return;
    }

    if (wantsMicrophone && !await _ensureMicrophonePermission()) {
      await request.deny();
      return;
    }

    await request.grant();
  }

  Future<bool> _ensureMicrophonePermission() async {
    var status = await Permission.microphone.status;
    if (status.isGranted) return true;

    status = await Permission.microphone.request();
    if (status.isGranted) return true;

    if (!mounted) return false;

    final permanentlyDenied = status.isPermanentlyDenied;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Microphone permission required'),
        content: Text(
          permanentlyDenied
              ? 'Microphone access is disabled for Asiye. Open your phone settings and allow Microphone access.'
              : 'Allow Microphone access when prompted to use camera features that include audio.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Not now'),
          ),
          if (permanentlyDenied)
            TextButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                await openAppSettings();
              },
              child: const Text('Open settings'),
            ),
        ],
      ),
    );

    return false;
  }

  Future<bool> _ensureCameraPermission() async {
    var status = await Permission.camera.status;
    if (status.isGranted) return true;

    status = await Permission.camera.request();
    if (status.isGranted) return true;

    if (!mounted) return false;

    final permanentlyDenied = status.isPermanentlyDenied;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Camera permission required'),
        content: Text(
          permanentlyDenied
              ? 'Camera access is disabled for Asiye. Open your phone settings and allow Camera access to take a photo.'
              : 'Allow Camera access when prompted so Asiye can take your photo.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Not now'),
          ),
          if (permanentlyDenied)
            TextButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                await openAppSettings();
              },
              child: const Text('Open settings'),
            ),
        ],
      ),
    );

    return false;
  }

  Future<String> _determineStartPage() async {
    final prefs = await SharedPreferences.getInstance();
    final String? userType = prefs.getString('userType');

    if (userType != null) {
      switch (userType) {
        case 'driver': return 'assets/driver-v2/index.html';
        case 'rank_manager': return 'assets/taxiRank.html';
        case 'handler': return 'assets/handler.html';
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
          } catch (e) {}
          break;
      }
    } catch (e) {}
  }

  void _sendBridgeResult(
    String callbackId, {
    bool ok = true,
    bool cancelled = false,
    Object? result,
    String? error,
  }) {
    if (callbackId.isEmpty) return;

    _callWeb('onAsiyeBridgeResult', {
      'callbackId': callbackId,
      'ok': ok,
      'cancelled': cancelled,
      'result': result,
      if (error != null) 'error': error,
    });
  }

  Future<void> _pickContactForWeb(Map<String, dynamic> data) async {
    final callbackId = data['callbackId']?.toString() ?? '';

    try {
      const picker = SystemContactPicker();
      final contact = await picker.pickContact();

      if (contact == null) {
        _sendBridgeResult(callbackId, cancelled: true);
        return;
      }

      final phone = contact.phones.isNotEmpty
          ? contact.phones.first.value.trim()
          : '';

      if (phone.isEmpty) {
        _sendBridgeResult(
          callbackId,
          ok: false,
          error: 'The selected contact does not have a mobile number.',
        );
        return;
      }

      _sendBridgeResult(
        callbackId,
        result: {
          'name': contact.displayName.trim(),
          'phone': phone,
        },
      );
    } catch (error) {
      debugPrint('Contact picker failed: $error');
      _sendBridgeResult(
        callbackId,
        ok: false,
        error: 'Unable to open your phone contacts. Please try again.',
      );
    }
  }

  Future<void> _scanImageForWeb(Map<String, dynamic> data) async {
    final callbackId = data['callbackId']?.toString() ?? '';

    try {
      if (!await _ensureCameraPermission()) {
        _sendBridgeResult(
          callbackId,
          ok: false,
          error: 'Camera permission is required to scan this image.',
        );
        return;
      }

      final facing =
          data['facing']?.toString().toLowerCase() == 'front'
              ? CameraDevice.front
              : CameraDevice.rear;

      final picker = ImagePicker();

      final photo = await picker.pickImage(
        source: ImageSource.camera,
        preferredCameraDevice: facing,
        imageQuality: 88,
        maxWidth: 1600,
        maxHeight: 2000,
      );

      if (photo == null) {
        _sendBridgeResult(callbackId, cancelled: true);
        return;
      }

      final bytes = await photo.readAsBytes();

      if (bytes.isEmpty) {
        _sendBridgeResult(
          callbackId,
          ok: false,
          error: 'The camera did not return a usable image.',
        );
        return;
      }

      final lowerPath = photo.path.toLowerCase();
      final mimeType = lowerPath.endsWith('.png')
          ? 'image/png'
          : lowerPath.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';

      _sendBridgeResult(
        callbackId,
        result: {
          'dataUrl': 'data:$mimeType;base64,${base64Encode(bytes)}',
          'mimeType': mimeType,
          'name': photo.name.isNotEmpty ? photo.name : 'asiye-scan.jpg',
          'purpose': data['purpose']?.toString() ?? 'image',
        },
      );
    } catch (error) {
      debugPrint('Native image scan failed: $error');
      _sendBridgeResult(
        callbackId,
        ok: false,
        error: 'Unable to scan the image. Check camera permission and try again.',
      );
    }
  }


  Future<void> _scanFaceForWeb(Map<String, dynamic> data) async {
    final callbackId = data['callbackId']?.toString() ?? '';

    try {
      if (!await _ensureCameraPermission()) {
        _sendBridgeResult(
          callbackId,
          ok: false,
          error: 'Camera permission is required for the live face scan.',
        );
        return;
      }

      if (!mounted) {
        _sendBridgeResult(
          callbackId,
          ok: false,
          error: 'The face scanner is not ready.',
        );
        return;
      }

      final purpose =
          data['purpose']?.toString() ??
          'profile';

      final roleTitle =
          purpose.contains('driver')
              ? 'Driver live face scan'
              : 'Passenger live face scan';

      final path = await Navigator.of(context).push<String>(
        MaterialPageRoute<String>(
          fullscreenDialog: true,
          builder:
              (_) => AsiyeLiveFaceScanScreen(
                title: roleTitle,
              ),
        ),
      );

      if (path == null || path.isEmpty) {
        _sendBridgeResult(
          callbackId,
          cancelled: true,
        );
        return;
      }

      final photo = XFile(path);
      final bytes = await photo.readAsBytes();

      if (bytes.isEmpty) {
        _sendBridgeResult(
          callbackId,
          ok: false,
          error: 'The live face scan did not return a usable image.',
        );
        return;
      }

      _sendBridgeResult(
        callbackId,
        result: {
          'dataUrl':
              'data:image/jpeg;base64,${base64Encode(bytes)}',
          'mimeType':
              'image/jpeg',
          'name':
              'asiye-live-face.jpg',
          'purpose':
              purpose,
          'liveCapture':
              true,
          'checks': [
            'single_face',
            'head_movement',
            'smile'
          ],
        },
      );
    } catch (error) {
      debugPrint('Native live face scan failed: $error');

      _sendBridgeResult(
        callbackId,
        ok: false,
        error:
            'Unable to complete the live face scan. Check Camera permission and try again.',
      );
    }
  }

  void _handleJsCalls(String message) async {
    try {
      if (message == "triggerGoogleSignIn" || message == "startGoogleSignIn") {
        _signInWithGoogle();
      } else if (message == "triggerAppleSignIn" || message == "startAppleSignIn") {
        _signInWithApple();
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
          if (action == 'startPhoneAuth') {
            await _startPhoneVerification(
              data['phone']?.toString() ?? '',
              forceResend: data['forceResend'] == true,
            );
          }
          else if (action == 'verifyPhoneAuthCode') {
            await _verifyPhoneAuthCode(
              data['code']?.toString() ?? '',
            );
          }
          else if (action == 'appReleaseConfig' && data['config'] is Map) {
            await _handleAppReleaseConfig(
              Map<String, dynamic>.from(data['config'] as Map),
            );
          }
          else if (action == 'openAppUpdate') {
            await _openAppUpdate(Map<String, dynamic>.from(data));
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
          else if (action == 'pickContact') {
            await _pickContactForWeb(data);
          }
          else if (action == 'scanFace') {
            await _scanFaceForWeb(data);
          }
          else if (action == 'scanImage') {
            await _scanImageForWeb(data);
          }
          else if (action == 'share') {
            final String text = data['text'] ?? '';
            if (text.isNotEmpty) {
              Share.share(text);
            }
          }
        } catch(_) {}
      }
    } catch (e) {}
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
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    await _googleSignIn.signOut().catchError((_) => null);

    try {
      await FirebaseAuth.instance.signOut();
    } catch (error) {
      debugPrint('Firebase sign-out failed: $error');
    }

    _phoneVerificationId = null;
    _phoneResendToken = null;

    // Explicitly wipe the JS memory before redirect
    _controller?.runJavaScript("localStorage.clear(); sessionStorage.clear();");
    _controller?.loadFlutterAsset('assets/passenger-v2/login.html');
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

    _controller?.loadFlutterAsset(target);
  }

  void _callWeb(String functionName, Object payload) {
    _controller?.runJavaScript(
      "if (typeof window.$functionName === 'function') { "
      "window.$functionName(${jsonEncode(payload)}); }",
    );
  }

  Future<void> _sendNativeFirebaseSessionToWeb(
    UserCredential credential,
    String provider,
  ) async {
    final user = credential.user;

    if (user == null) {
      _callWeb('onNativeFirebaseAuthError', {
        'provider': provider,
        'code': 'missing-user',
        'message': 'Firebase did not return an authenticated user.',
      });
      return;
    }

    try {
      final idToken = await user.getIdToken(true);

      if (idToken == null || idToken.isEmpty) {
        throw StateError('Firebase did not return an ID token.');
      }

      _callWeb('onNativeFirebaseAuthSuccess', {
        'provider': provider,
        'firebaseIdToken': idToken,
        'uid': user.uid,
        'email': user.email ?? '',
        'phoneNumber': user.phoneNumber ?? '',
        'displayName': user.displayName ?? '',
        'photoUrl': user.photoURL ?? '',
      });
    } catch (error) {
      debugPrint('Unable to create native Firebase session handoff: $error');

      _callWeb('onNativeFirebaseAuthError', {
        'provider': provider,
        'code': 'session-handoff-failed',
        'message': error.toString(),
      });
    }
  }

  Future<void> _startPhoneVerification(
    String phoneNumber, {
    bool forceResend = false,
  }) async {
    if (phoneNumber.isEmpty) {
      _callWeb('onNativePhoneAuthError', {
        'code': 'invalid-phone-number',
        'message': 'Enter a valid mobile number.',
      });
      return;
    }

    if (!_isFirebaseInitialized) {
      _callWeb('onNativePhoneAuthError', {
        'code': 'firebase-not-initialized',
        'message': 'Firebase could not initialize on this device.',
      });
      return;
    }

    try {
      final maskedPhone = phoneNumber.length > 5
          ? '${phoneNumber.substring(0, 3)}*****${phoneNumber.substring(phoneNumber.length - 2)}'
          : '***';

      debugPrint(
        'Starting phone verification for $maskedPhone (forceResend: $forceResend)',
      );

      await FirebaseAuth.instance.verifyPhoneNumber(
        phoneNumber: phoneNumber,
        timeout: const Duration(seconds: 60),
        forceResendingToken:
            forceResend ? _phoneResendToken : null,
        verificationCompleted: (PhoneAuthCredential credential) async {
          try {
            final result =
                await FirebaseAuth.instance.signInWithCredential(credential);

            _phoneVerificationId = null;

            await _sendNativeFirebaseSessionToWeb(
              result,
              'phone',
            );
          } on FirebaseAuthException catch (error) {
            debugPrint(
              'Automatic phone verification failed [${error.code}]: ${error.message}',
            );

            _callWeb('onNativeFirebaseAuthError', {
              'provider': 'phone',
              'code': error.code,
              'message': error.message ?? 'Phone verification failed.',
            });
          } catch (error) {
            _callWeb('onNativeFirebaseAuthError', {
              'provider': 'phone',
              'code': 'phone-auto-verification-failed',
              'message': error.toString(),
            });
          }
        },
        verificationFailed: (FirebaseAuthException error) {
          debugPrint(
            'Phone verification failed [${error.code}]: ${error.message}',
          );

          _callWeb('onNativePhoneAuthError', {
            'code': error.code,
            'message': error.message ?? 'Phone verification failed.',
          });
        },
        codeSent: (String verificationId, int? resendToken) {
          _phoneVerificationId = verificationId;
          _phoneResendToken = resendToken;

          debugPrint('Phone verification code sent successfully.');

          _callWeb('onNativePhoneCodeSent', {
            'verificationId': verificationId,
            'resendToken': resendToken,
          });
        },
        codeAutoRetrievalTimeout: (String verificationId) {
          _phoneVerificationId = verificationId;

          _callWeb('onNativePhoneAutoRetrievalTimeout', {
            'verificationId': verificationId,
          });
        },
      );
    } catch (error) {
      debugPrint('Native phone auth exception: $error');

      _callWeb('onNativePhoneAuthError', {
        'code': 'native-phone-auth-failed',
        'message': error.toString(),
      });
    }
  }

  Future<void> _verifyPhoneAuthCode(
    String smsCode,
  ) async {
    final verificationId =
        _phoneVerificationId;

    if (
      verificationId == null ||
      verificationId.isEmpty
    ) {
      _callWeb('onNativeFirebaseAuthError', {
        'provider': 'phone',
        'code': 'missing-verification-id',
        'message': 'Your verification session expired. Please request a new code.',
      });
      return;
    }

    final code =
        smsCode.replaceAll(RegExp(r'\D'), '');

    if (code.length != 6) {
      _callWeb('onNativeFirebaseAuthError', {
        'provider': 'phone',
        'code': 'invalid-verification-code',
        'message': 'Enter the 6-digit verification code.',
      });
      return;
    }

    try {
      final credential =
          PhoneAuthProvider.credential(
            verificationId:
                verificationId,
            smsCode:
                code,
          );

      final result =
          await FirebaseAuth.instance
              .signInWithCredential(
                credential
              );

      _phoneVerificationId =
          null;

      await _sendNativeFirebaseSessionToWeb(
        result,
        'phone',
      );

    } on FirebaseAuthException catch (error) {
      debugPrint(
        'Phone code verification failed [${error.code}]: ${error.message}',
      );

      _callWeb('onNativeFirebaseAuthError', {
        'provider': 'phone',
        'code': error.code,
        'message': error.message ?? 'Unable to verify the SMS code.',
      });
    } catch (error) {
      _callWeb('onNativeFirebaseAuthError', {
        'provider': 'phone',
        'code': 'phone-code-verification-failed',
        'message': error.toString(),
      });
    }
  }

  Future<void> _signInWithGoogle() async {
    try {
      await _googleSignIn
          .signOut()
          .catchError(
            (_) => null
          );

      try {
        await FirebaseAuth.instance
            .signOut();
      } catch (_) {}

      final GoogleSignInAccount? account =
          await _googleSignIn
              .authenticate();

      if (account == null) {
        _callWeb(
          'onNativeFirebaseAuthError',
          {
            'provider': 'google',
            'code': 'cancelled',
            'message': 'Google sign-in was cancelled.',
          },
        );
        return;
      }

      final GoogleSignInAuthentication auth =
          account.authentication;

      if (
        auth.idToken == null ||
        auth.idToken!.isEmpty
      ) {
        throw StateError(
          'Google did not return an ID token.'
        );
      }

      final firebaseCredential =
          GoogleAuthProvider
              .credential(
                idToken:
                    auth.idToken,
              );

      final result =
          await FirebaseAuth.instance
              .signInWithCredential(
                firebaseCredential
              );

      await _sendNativeFirebaseSessionToWeb(
        result,
        'google',
      );

    } on FirebaseAuthException catch (error) {
      debugPrint(
        'Google Firebase authentication failed [${error.code}]: ${error.message}',
      );

      _callWeb(
        'onNativeFirebaseAuthError',
        {
          'provider': 'google',
          'code': error.code,
          'message': error.message ?? 'Google authentication failed.',
        },
      );

    } catch (error) {
      debugPrint(
        'Google authentication failed: $error'
      );

      _callWeb(
        'onNativeFirebaseAuthError',
        {
          'provider': 'google',
          'code': 'native-google-failed',
          'message': error.toString(),
        },
      );
    }
  }

  Future<void> _signInWithApple() async {
    try {
      try {
        await FirebaseAuth.instance
            .signOut();
      } catch (_) {}

      final appleProvider =
          AppleAuthProvider();

      final result =
          await FirebaseAuth.instance
              .signInWithProvider(
                appleProvider
              );

      await _sendNativeFirebaseSessionToWeb(
        result,
        'apple',
      );

    } on FirebaseAuthException catch (error) {
      debugPrint(
        'Apple Firebase authentication failed [${error.code}]: ${error.message}',
      );

      _callWeb(
        'onNativeFirebaseAuthError',
        {
          'provider': 'apple',
          'code': error.code,
          'message': error.message ?? 'Apple authentication failed.',
        },
      );

    } catch (error) {
      debugPrint(
        'Apple authentication failed: $error'
      );

      _callWeb(
        'onNativeFirebaseAuthError',
        {
          'provider': 'apple',
          'code': 'native-apple-failed',
          'message': error.toString(),
        },
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          if (_controller != null) WebViewWidget(controller: _controller!),
          if (_controller == null || _isLoading) _buildNativePreloader(),
        ],
      ),
    );
  }
}
