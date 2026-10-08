import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

/// In-app rear camera: one shutter press captures the car and returns the
/// picture to the driver Vehicle screen. No external camera confirmation step.
class AsiyeVehicleCameraScreen extends StatefulWidget {
  const AsiyeVehicleCameraScreen({super.key});

  @override
  State<AsiyeVehicleCameraScreen> createState() =>
      _AsiyeVehicleCameraScreenState();
}

class _AsiyeVehicleCameraScreenState extends State<AsiyeVehicleCameraScreen>
    with WidgetsBindingObserver {
  CameraController? _controller;
  bool _loading = true;
  bool _capturing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_openCamera());
  }

  Future<void> _openCamera() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        throw StateError('No camera is available on this device.');
      }
      final rear = cameras.where(
        (camera) => camera.lensDirection == CameraLensDirection.back,
      );
      final camera = rear.isNotEmpty ? rear.first : cameras.first;
      final controller = CameraController(
        camera,
        ResolutionPreset.high,
        enableAudio: false,
      );
      _controller = controller;
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      try {
        await controller.setFlashMode(FlashMode.off);
      } catch (_) {
        // Some phone cameras do not expose flash controls.
      }
      setState(() => _loading = false);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not open the rear camera. Check Asiye camera permission and try again.';
      });
      debugPrint('Asiye vehicle camera failed: $error');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Native camera controllers must not hold the camera while the application
    // is in the background. Restore the preview when the driver returns.
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      final camera = _controller;
      _controller = null;
      if (camera != null && !_capturing) unawaited(camera.dispose());
    } else if (state == AppLifecycleState.resumed &&
        _controller == null && !_capturing) {
      unawaited(_openCamera());
    }
  }

  Future<void> _takeCarPicture() async {
    final camera = _controller;
    if (_capturing || camera == null || !camera.value.isInitialized) return;
    setState(() => _capturing = true);
    try {
      final photo = await camera.takePicture();
      if (!mounted) return;
      // Return to the existing WebView route automatically and hand the image
      // to onNativeFaceCaptureSuccess for authenticated upload.
      Navigator.of(context).pop(photo.path);
    } catch (error) {
      debugPrint('Asiye vehicle picture failed: $error');
      if (mounted) {
        setState(() {
          _capturing = false;
          _error = 'The car picture was not captured. Please try again.';
        });
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    final camera = _controller;
    _controller = null;
    if (camera != null) unawaited(camera.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF57E389);
    final camera = _controller;
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (!_loading && camera != null && camera.value.isInitialized)
              Center(child: CameraPreview(camera))
            else
              const Center(
                child: CircularProgressIndicator(color: green),
              ),
            Positioned(
              left: 12,
              right: 12,
              top: 8,
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'Back to Asiye',
                    icon: const Icon(Icons.arrow_back, color: Colors.white),
                    onPressed: _capturing
                        ? null
                        : () => Navigator.of(context).pop(),
                  ),
                  const Expanded(
                    child: Text(
                      'Photograph your vehicle',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 48),
                ],
              ),
            ),
            Positioned(
              left: 20,
              right: 20,
              bottom: 20,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Fit the entire car and registration plate in the frame.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      shadows: [Shadow(blurRadius: 8, color: Colors.black)],
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.orangeAccent),
                    ),
                  ],
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: green,
                      foregroundColor: Colors.black,
                      minimumSize: const Size.fromHeight(56),
                    ),
                    onPressed: _loading || _capturing || _error != null
                        ? null
                        : _takeCarPicture,
                    icon: _capturing
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.camera_alt),
                    label: Text(_capturing ? 'Returning to Asiye…' : 'Take car picture'),
                  ),
                  if (_error != null)
                    TextButton(
                      onPressed: _capturing ? null : _openCamera,
                      child: const Text('Try camera again'),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
