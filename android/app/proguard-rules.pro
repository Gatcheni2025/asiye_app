# Keep runtime annotations/signatures used by Android, Firebase and plugins.
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Keep Firebase Messaging entry points referenced from Android manifests.
-keep class io.flutter.plugins.firebase.messaging.** { *; }

# Keep Google Play services / authentication model metadata used reflectively.
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# Flutter/plugin registrants and native bridge classes are resolved by name.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
