# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ───────── 워크인: 코드 줄이기(R8)를 켰을 때 지켜야 하는 것 (2026-11-19, ANDROID_MINIFY=1 일 때만 쓰임) ─────────
# 충돌 기록의 줄 번호는 남기고 원본 파일 이름은 감춤
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# Capacitor: 플러그인을 이름(capacitor.plugins.json 의 classpath)과 주석으로 찾고, 메서드를 반사로 부른다
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.PermissionCallback *;
    @com.getcapacitor.annotation.ActivityCallback *;
    @android.webkit.JavascriptInterface <methods>;
}
-keep class org.apache.cordova.** { *; }

# 쓰는 플러그인(이름으로 불러옴)
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.getcapacitor.community.** { *; }
-keep class io.capawesome.capacitorjs.plugins.firebase.messaging.** { *; }
-keep class com.aparajita.capacitor.biometricauth.** { *; }
-keep class app.capgo.speechrecognition.** { *; }

# 우리 네이티브 코드: 알람·위젯·알림 단추·푸시 서비스·네이티브 플러그인(매니페스트·플러그인 이름으로 찾음)
-keep class kr.co.dagym.workos.** { *; }

# 플러그인이 선택으로만 쓰는 클래스가 없을 때의 경고는 빌드를 막지 않게
-dontwarn com.getcapacitor.**
-dontwarn io.capawesome.**
-dontwarn app.capgo.**
