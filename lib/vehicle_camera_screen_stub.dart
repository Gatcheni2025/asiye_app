import 'package:flutter/material.dart';

/// Web/test fallback. The installed Android/iOS app uses the native screen.
class AsiyeVehicleCameraScreen extends StatelessWidget {
  const AsiyeVehicleCameraScreen({super.key});

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: Text('Vehicle camera is available in the Asiye app.')),
      );
}
