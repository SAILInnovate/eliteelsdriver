# R8 / ProGuard rules for the ELS Driver app.
#
# Releases are minified so Google Play's DEX optimisation check passes (an
# unminified build scores ~4% obfuscation, which Play flags as below threshold).
#
# Minification renames classes and strips "unused" members, which is dangerous
# for anything the framework looks up by name at runtime. Everything kept below
# is kept because something reaches it by string or by reflection.

# ---------------------------------------------------------------------------
# WebView <-> native bridge
# ---------------------------------------------------------------------------
# capacitor.config.json sets android.useLegacyBridge = true, so Capacitor calls
# webView.addJavascriptInterface(this, "androidBridge") with its MessageHandler.
# MessageHandler is NOT a Plugin subclass, so Capacitor's own consumer rules do
# not cover it. If R8 renames these methods the JS side calls into nothing and
# the app boots to a blank screen.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.getcapacitor.MessageHandler { *; }

# Plugins that inject their own JS interfaces (CapacitorHttp, CapacitorCookies,
# SystemBars). Covered by the @JavascriptInterface rule above, but named here so
# the dependency is obvious if that rule is ever removed.
-keep class com.getcapacitor.plugin.CapacitorHttp { *; }
-keep class com.getcapacitor.plugin.CapacitorCookies { *; }
-keep class com.getcapacitor.plugin.SystemBars { *; }

# ---------------------------------------------------------------------------
# Capacitor plugins
# ---------------------------------------------------------------------------
# Plugins are instantiated by class name from the generated capacitor.plugins.json,
# and their @PluginMethod entries are invoked by name from JavaScript.
# @capacitor/android ships equivalent consumer rules; repeated here because this
# app's release build is the only place they are exercised.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }

# Cordova plugin shims (capacitor-cordova-android-plugins module).
-keep public class * extends org.apache.cordova.* {
    public <methods>;
    public <fields>;
}

# ---------------------------------------------------------------------------
# Background geolocation
# ---------------------------------------------------------------------------
# The service is declared in AndroidManifest and started by name; the plugin
# ships no keep rules of its own.
-keep class com.equimaps.capacitor_background_geolocation.** { *; }

# ---------------------------------------------------------------------------
# Firebase
# ---------------------------------------------------------------------------
# firebase-installations-ktx references com.google.firebase.ktx.Firebase from
# firebase-ktx, which is not on the classpath. Nothing calls it, so R8 only
# needs to stop treating it as a hard error. Same rule AGP suggests in
# build/outputs/mapping/release/missing_rules.txt.
#
# Deliberately NOT keeping com.google.firebase.** wholesale: Firebase ships its
# own consumer rules, and blanket keeps would suppress obfuscation across a very
# large package — worsening the DEX-optimisation score this change exists to fix.
-dontwarn com.google.firebase.ktx.Firebase
-dontwarn com.google.firebase.ktx.**

# Stripe and RevenueCat likewise publish consumer rules; keep nothing extra.

# ---------------------------------------------------------------------------
# General safety
# ---------------------------------------------------------------------------
# Keep annotations R8 would otherwise discard, and preserve enough of the stack
# trace to make a Play Console crash report readable.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Activities, services and receivers named in AndroidManifest.xml.
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.content.ContentProvider

# Custom Views inflated from XML.
-keep public class * extends android.view.View {
    public <init>(android.content.Context);
    public <init>(android.content.Context, android.util.AttributeSet);
    public <init>(android.content.Context, android.util.AttributeSet, int);
    public void set*(...);
}

# Parcelable CREATOR fields.
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Enum valueOf/values, used reflectively by some serialisers.
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Native method bindings.
-keepclasseswithmembernames class * {
    native <methods>;
}

# Suppress warnings for optional dependencies the plugins reference but the app
# does not bundle.
-dontwarn org.apache.cordova.**
-dontwarn com.getcapacitor.**
