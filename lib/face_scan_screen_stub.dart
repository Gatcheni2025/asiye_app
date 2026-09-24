import 'package:flutter/material.dart';

/// Web compile-time fallback.
///
/// The hosted web experience continues to use assets/face-scanner.js via
/// getUserMedia. The native Flutter screen is only instantiated on Android/iOS.
class AsiyeLiveFaceScanScreen extends StatelessWidget {
  const AsiyeLiveFaceScanScreen({
    super.key,
    this.title = 'Live face scan',
  });

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.face_rounded,
                  color: Colors.white,
                  size: 54,
                ),
                const SizedBox(height: 18),
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                const Text(
                  'Live native face scanning is available in the Asiye mobile app.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white70,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Close'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
