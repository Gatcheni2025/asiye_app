import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

/// Full-screen native selfie scanner used by the WebView bridge.
///
/// It performs lightweight on-device face detection and a simple movement
/// challenge before automatically taking a still image. It is deliberately
/// used for profile-photo capture, not identity matching.
class AsiyeLiveFaceScanScreen extends StatefulWidget {
  const AsiyeLiveFaceScanScreen({
    super.key,
    this.title = 'Live face scan',
  });

  final String title;

  @override
  State<AsiyeLiveFaceScanScreen> createState() =>
      _AsiyeLiveFaceScanScreenState();
}

class _AsiyeLiveFaceScanScreenState extends State<AsiyeLiveFaceScanScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  CameraController? _cameraController;
  CameraDescription? _cameraDescription;

  final FaceDetector _faceDetector = FaceDetector(
    options: FaceDetectorOptions(
      performanceMode: FaceDetectorMode.fast,
      enableClassification: true,
      enableTracking: true,
      minFaceSize: 0.16,
    ),
  );

  late final AnimationController _scanAnimation;

  bool _initialising = true;
  bool _processingFrame = false;
  bool _capturing = false;
  bool _faceVisible = false;
  bool _cameraPaused = false;
  String? _error;

  int _phase = 0;
  int _steadyFrames = 0;
  String _instruction = 'Starting front camera…';

  static const Map<DeviceOrientation, int> _orientations = {
    DeviceOrientation.portraitUp: 0,
    DeviceOrientation.landscapeLeft: 90,
    DeviceOrientation.portraitDown: 180,
    DeviceOrientation.landscapeRight: 270,
  };

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _scanAnimation = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1750),
    )..repeat(reverse: true);

    unawaited(_initialiseCamera());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = _cameraController;

    if (controller == null || !controller.value.isInitialized) {
      return;
    }

    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      _cameraPaused = true;
      unawaited(_stopImageStream());
    } else if (state == AppLifecycleState.resumed && _cameraPaused) {
      _cameraPaused = false;
      if (!_capturing) {
        unawaited(_restartImageStream());
      }
    }
  }

  Future<void> _initialiseCamera() async {
    try {
      final cameras = await availableCameras();

      if (cameras.isEmpty) {
        throw CameraException(
          'NoCamera',
          'No camera is available on this device.',
        );
      }

      CameraDescription selected = cameras.first;

      for (final camera in cameras) {
        if (camera.lensDirection == CameraLensDirection.front) {
          selected = camera;
          break;
        }
      }

      _cameraDescription = selected;

      final imageFormatGroup =
          defaultTargetPlatform == TargetPlatform.iOS
              ? ImageFormatGroup.bgra8888
              : ImageFormatGroup.nv21;

      final controller = CameraController(
        selected,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: imageFormatGroup,
      );

      _cameraController = controller;

      await controller.initialize();

      if (!mounted) return;

      try {
        await controller.setFlashMode(FlashMode.off);
      } catch (_) {
        // Front cameras may not expose flash controls.
      }

      setState(() {
        _initialising = false;
        _instruction = 'Centre your face inside the oval';
      });

      await controller.startImageStream(_processCameraImage);
    } on CameraException catch (error) {
      _showError(
        error.code == 'CameraAccessDenied'
            ? 'Camera permission is required for a live face scan.'
            : (error.description ?? 'Unable to start the front camera.'),
      );
    } catch (error) {
      _showError('Unable to start the live face scan. Please try again.');
      debugPrint('Face scan camera init failed: $error');
    }
  }

  void _showError(String message) {
    if (!mounted) return;

    setState(() {
      _initialising = false;
      _error = message;
      _instruction = message;
      _faceVisible = false;
    });
  }

  Future<void> _stopImageStream() async {
    final controller = _cameraController;

    if (controller == null ||
        !controller.value.isInitialized ||
        !controller.value.isStreamingImages) {
      return;
    }

    try {
      await controller.stopImageStream();
    } catch (_) {
      // A lifecycle transition may already have stopped it.
    }
  }

  Future<void> _restartImageStream() async {
    final controller = _cameraController;

    if (controller == null ||
        !controller.value.isInitialized ||
        controller.value.isStreamingImages ||
        _capturing) {
      return;
    }

    try {
      await controller.startImageStream(_processCameraImage);
    } catch (error) {
      debugPrint('Could not restart face scan stream: $error');
    }
  }

  InputImage? _inputImageFromCameraImage(CameraImage image) {
    final camera = _cameraDescription;
    final controller = _cameraController;

    if (camera == null || controller == null) return null;

    final sensorOrientation = camera.sensorOrientation;
    InputImageRotation? rotation;

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      rotation =
          InputImageRotationValue.fromRawValue(sensorOrientation);
    } else if (defaultTargetPlatform == TargetPlatform.android) {
      var rotationCompensation =
          _orientations[controller.value.deviceOrientation];

      if (rotationCompensation == null) return null;

      if (camera.lensDirection == CameraLensDirection.front) {
        rotationCompensation =
            (sensorOrientation + rotationCompensation) % 360;
      } else {
        rotationCompensation =
            (sensorOrientation - rotationCompensation + 360) % 360;
      }

      rotation =
          InputImageRotationValue.fromRawValue(rotationCompensation);
    }

    if (rotation == null) return null;

    final format =
        InputImageFormatValue.fromRawValue(image.format.raw);

    if (format == null) return null;

    if (defaultTargetPlatform == TargetPlatform.android &&
        format != InputImageFormat.nv21) {
      return null;
    }

    if (defaultTargetPlatform == TargetPlatform.iOS &&
        format != InputImageFormat.bgra8888) {
      return null;
    }

    if (image.planes.length != 1) return null;

    final plane = image.planes.first;

    return InputImage.fromBytes(
      bytes: plane.bytes,
      metadata: InputImageMetadata(
        size: Size(
          image.width.toDouble(),
          image.height.toDouble(),
        ),
        rotation: rotation,
        format: format,
        bytesPerRow: plane.bytesPerRow,
      ),
    );
  }

  Future<void> _processCameraImage(CameraImage image) async {
    if (_processingFrame || _capturing || !mounted) return;

    _processingFrame = true;

    try {
      final inputImage = _inputImageFromCameraImage(image);

      if (inputImage == null) {
        return;
      }

      final faces = await _faceDetector.processImage(inputImage);

      if (!mounted || _capturing) return;

      if (faces.isEmpty) {
        _steadyFrames = 0;
        _setScanState(
          faceVisible: false,
          message: 'Move closer until your face is inside the oval',
        );
        return;
      }

      if (faces.length > 1) {
        _steadyFrames = 0;
        _setScanState(
          faceVisible: false,
          message: 'Only one person should be visible',
        );
        return;
      }

      final face = faces.first;
      final yaw = (face.headEulerAngleY ?? 0).abs();
      final roll = (face.headEulerAngleZ ?? 0).abs();
      final faceArea =
          face.boundingBox.width *
          face.boundingBox.height;
      final frameArea =
          image.width.toDouble() *
          image.height.toDouble();
      final faceRatio =
          frameArea > 0
              ? faceArea / frameArea
              : 0.0;

      if (faceRatio < 0.035) {
        _steadyFrames = 0;
        _setScanState(
          faceVisible: true,
          message: 'Move a little closer',
        );
        return;
      }

      if (_phase == 0) {
        final centred =
            yaw < 12 &&
            roll < 14;

        if (!centred) {
          _steadyFrames = 0;
          _setScanState(
            faceVisible: true,
            message: 'Look straight at the camera',
          );
          return;
        }

        _steadyFrames++;

        if (_steadyFrames >= 3) {
          _phase = 1;
          _steadyFrames = 0;
          _setScanState(
            faceVisible: true,
            message: 'Good. Slowly turn your head to either side',
          );
        } else {
          _setScanState(
            faceVisible: true,
            message: 'Hold still…',
          );
        }

        return;
      }

      if (_phase == 1) {
        if (yaw >= 18) {
          _phase = 2;
          _setScanState(
            faceVisible: true,
            message: 'Great. Look forward and smile',
          );
        } else {
          _setScanState(
            faceVisible: true,
            message: 'Slowly turn your head to either side',
          );
        }

        return;
      }

      if (_phase == 2) {
        final smile =
            face.smilingProbability ??
            0.0;

        if (yaw < 14 && smile >= 0.52) {
          _phase = 3;
          _setScanState(
            faceVisible: true,
            message: 'Verified. Capturing profile photo…',
          );

          unawaited(_captureVerifiedFace());
        } else if (yaw >= 14) {
          _setScanState(
            faceVisible: true,
            message: 'Look back at the camera',
          );
        } else {
          _setScanState(
            faceVisible: true,
            message: 'Smile naturally',
          );
        }
      }
    } catch (error) {
      debugPrint('Face detection frame failed: $error');
    } finally {
      _processingFrame = false;
    }
  }

  void _setScanState({
    required bool faceVisible,
    required String message,
  }) {
    if (!mounted) return;

    if (_faceVisible == faceVisible &&
        _instruction == message) {
      return;
    }

    setState(() {
      _faceVisible = faceVisible;
      _instruction = message;
    });
  }

  Future<void> _captureVerifiedFace() async {
    if (_capturing) return;

    _capturing = true;

    final controller = _cameraController;

    if (controller == null ||
        !controller.value.isInitialized) {
      _showError('The camera is not ready.');
      _capturing = false;
      return;
    }

    try {
      await _stopImageStream();
      await Future<void>.delayed(
        const Duration(milliseconds: 280),
      );

      final image = await controller.takePicture();

      if (!mounted) return;

      Navigator.of(context).pop(image.path);
    } catch (error) {
      debugPrint('Verified face capture failed: $error');

      _capturing = false;
      _phase = 0;
      _steadyFrames = 0;

      _setScanState(
        faceVisible: false,
        message: 'Capture failed. Centre your face and try again',
      );

      await _restartImageStream();
    }
  }

  Widget _buildProgressStep(
    int index,
    IconData icon,
    String label,
  ) {
    final complete =
        _phase > index;
    final active =
        _phase == index;

    return Expanded(
      child: Column(
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color:
                  complete
                      ? const Color(0xFF57E389)
                      : active
                          ? Colors.white
                          : Colors.white.withValues(alpha: .13),
              border: Border.all(
                color:
                    complete || active
                        ? Colors.white
                        : Colors.white.withValues(alpha: .28),
              ),
            ),
            child: Icon(
              complete
                  ? Icons.check_rounded
                  : icon,
              size: 17,
              color:
                  complete
                      ? const Color(0xFF0D2A1A)
                      : active
                          ? const Color(0xFF111B16)
                          : Colors.white70,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            label,
            style: TextStyle(
              color:
                  complete || active
                      ? Colors.white
                      : Colors.white60,
              fontSize: 10,
              fontWeight:
                  active
                      ? FontWeight.w800
                      : FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCamera() {
    final controller = _cameraController;

    if (controller == null ||
        !controller.value.isInitialized) {
      return const Center(
        child: CircularProgressIndicator(
          color: Colors.white,
        ),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final previewSize =
            controller.value.previewSize;

        if (previewSize == null) {
          return CameraPreview(controller);
        }

        final viewport =
            Size(
              constraints.maxWidth,
              constraints.maxHeight,
            );

        final scale = 1 /
            (controller.value.aspectRatio *
                viewport.aspectRatio);

        return Transform.scale(
          scale:
              scale < 1
                  ? 1 / scale
                  : scale,
          child: Center(
            child: Transform(
              alignment: Alignment.center,
              transform:
                  Matrix4.diagonal3Values(
                    -1.0,
                    1.0,
                    1.0,
                  ),
              child: CameraPreview(
                controller,
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    const green =
        Color(0xFF57E389);

    return PopScope(
      canPop: !_capturing,
      child: Scaffold(
        backgroundColor:
            Colors.black,
        body: SafeArea(
          top: false,
          bottom: false,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (!_initialising &&
                  _error == null)
                _buildCamera()
              else
                Container(
                  color:
                      const Color(0xFF07120C),
                ),

              Container(
                decoration:
                    const BoxDecoration(
                  gradient:
                      LinearGradient(
                    begin:
                        Alignment.topCenter,
                    end:
                        Alignment.bottomCenter,
                    colors: [
                      Color(0xCC000000),
                      Color(0x22000000),
                      Color(0x33000000),
                      Color(0xE6000000),
                    ],
                    stops: [
                      0,
                      .24,
                      .62,
                      1,
                    ],
                  ),
                ),
              ),

              SafeArea(
                child: Padding(
                  padding:
                      const EdgeInsets.fromLTRB(
                    20,
                    12,
                    20,
                    24,
                  ),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          IconButton.filledTonal(
                            onPressed:
                                _capturing
                                    ? null
                                    : () => Navigator.of(context).pop(),
                            style:
                                IconButton.styleFrom(
                              backgroundColor:
                                  Colors.black.withValues(alpha: .35),
                              foregroundColor:
                                  Colors.white,
                            ),
                            icon:
                                const Icon(
                              Icons.close_rounded,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'ASIYE · LIVE VERIFICATION',
                                  style: TextStyle(
                                    color: Colors.white60,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 1.2,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  widget.title,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 20,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      const Spacer(),

                      SizedBox(
                        width: 282,
                        height: 360,
                        child: Stack(
                          alignment:
                              Alignment.center,
                          children: [
                            AnimatedContainer(
                              duration:
                                  const Duration(milliseconds: 220),
                              width: 270,
                              height: 348,
                              decoration:
                                  BoxDecoration(
                                borderRadius:
                                    BorderRadius.circular(150),
                                border:
                                    Border.all(
                                  color:
                                      _phase >= 3
                                          ? green
                                          : _faceVisible
                                              ? Colors.white
                                              : Colors.white54,
                                  width:
                                      _faceVisible
                                          ? 3
                                          : 2,
                                ),
                                boxShadow: [
                                  BoxShadow(
                                    color:
                                        (_faceVisible
                                                ? green
                                                : Colors.white)
                                            .withValues(alpha: .13),
                                    blurRadius: 32,
                                    spreadRadius: 4,
                                  ),
                                ],
                              ),
                            ),

                            ClipRRect(
                              borderRadius:
                                  BorderRadius.circular(150),
                              child:
                                  AnimatedBuilder(
                                animation:
                                    _scanAnimation,
                                builder:
                                    (context, child) {
                                  return Align(
                                    alignment:
                                        Alignment(
                                      0,
                                      -0.8 +
                                          (_scanAnimation.value * 1.6),
                                    ),
                                    child:
                                        Container(
                                      width: 220,
                                      height: 2,
                                      decoration:
                                          BoxDecoration(
                                        color:
                                            _phase >= 3
                                                ? green
                                                : Colors.white,
                                        boxShadow: [
                                          BoxShadow(
                                            color:
                                                (_phase >= 3
                                                        ? green
                                                        : Colors.white)
                                                    .withValues(alpha: .9),
                                            blurRadius: 12,
                                          ),
                                        ],
                                      ),
                                    ),
                                  );
                                },
                              ),
                            ),

                            if (_capturing)
                              Container(
                                width: 270,
                                height: 348,
                                decoration:
                                    BoxDecoration(
                                  color:
                                      Colors.black.withValues(alpha: .22),
                                  borderRadius:
                                      BorderRadius.circular(150),
                                ),
                                child:
                                    const Center(
                                  child:
                                      CircularProgressIndicator(
                                    color:
                                        green,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 20),

                      AnimatedSwitcher(
                        duration:
                            const Duration(milliseconds: 220),
                        child: Container(
                          key: ValueKey(
                            _instruction,
                          ),
                          constraints:
                              const BoxConstraints(
                            maxWidth: 360,
                          ),
                          padding:
                              const EdgeInsets.symmetric(
                            horizontal: 18,
                            vertical: 12,
                          ),
                          decoration:
                              BoxDecoration(
                            color:
                                Colors.black.withValues(alpha: .50),
                            borderRadius:
                                BorderRadius.circular(18),
                            border:
                                Border.all(
                              color:
                                  Colors.white.withValues(alpha: .15),
                            ),
                          ),
                          child: Row(
                            mainAxisSize:
                                MainAxisSize.min,
                            children: [
                              Icon(
                                _error != null
                                    ? Icons.error_outline_rounded
                                    : _phase >= 3
                                        ? Icons.verified_rounded
                                        : Icons.face_rounded,
                                color:
                                    _error != null
                                        ? Colors.orangeAccent
                                        : _phase >= 3
                                            ? green
                                            : Colors.white,
                                size: 20,
                              ),
                              const SizedBox(width: 10),
                              Flexible(
                                child: Text(
                                  _instruction,
                                  textAlign:
                                      TextAlign.center,
                                  style:
                                      const TextStyle(
                                    color:
                                        Colors.white,
                                    fontSize: 13,
                                    height: 1.35,
                                    fontWeight:
                                        FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      const SizedBox(height: 18),

                      Row(
                        children: [
                          _buildProgressStep(
                            0,
                            Icons.face_rounded,
                            'Centre',
                          ),
                          _buildProgressStep(
                            1,
                            Icons.sync_alt_rounded,
                            'Move',
                          ),
                          _buildProgressStep(
                            2,
                            Icons.sentiment_satisfied_alt_rounded,
                            'Smile',
                          ),
                        ],
                      ),

                      const SizedBox(height: 18),

                      Text(
                        _error != null
                            ? 'Close and try again after checking Camera permission.'
                            : 'Keep the phone steady. Asiye captures automatically when the live scan is complete.',
                        textAlign:
                            TextAlign.center,
                        style:
                            TextStyle(
                          color:
                              Colors.white.withValues(alpha: .65),
                          fontSize: 11,
                          height: 1.45,
                        ),
                      ),

                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: () {
                            setState(() {
                              _error = null;
                              _initialising = true;
                              _phase = 0;
                              _instruction =
                                  'Starting front camera…';
                            });
                            unawaited(_initialiseCamera());
                          },
                          style:
                              FilledButton.styleFrom(
                            backgroundColor:
                                Colors.white,
                            foregroundColor:
                                Colors.black,
                          ),
                          child:
                              const Text(
                            'Try again',
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scanAnimation.dispose();

    final controller = _cameraController;
    if (controller != null) {
      unawaited(controller.dispose());
    }

    unawaited(_faceDetector.close());
    super.dispose();
  }
}
