package kr.co.dagym.workos;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.URLUtil;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 서버가 보내는 FCM 알림 채널(work)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel("work", "업무 알림", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("업무 배정·멘션·마감·검토·일정 변경 알림");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        // 카카오톡 공유 등 앱 호출 주소(intent://, kakaolink://, kakaotalk://)는 웹뷰가 못 여니 기기 앱으로 넘긴다.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (openExternalScheme(request.getUrl().toString())) return true;
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
        // 웹의 내려받기 링크(/api/... 엑셀·CSV·문서)를 기기 '다운로드' 폴더로 받는다.
        // 로그인 쿠키를 같이 보내야 서버가 파일을 준다. blob:/data: 주소는 웹 쪽에서 처리.
        getBridge().getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
            try {
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) req.addRequestHeader("Cookie", cookie);
                req.addRequestHeader("User-Agent", userAgent);
                req.setMimeType(mimeType);
                req.setTitle(name);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, "내려받는 중: " + name, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "내려받기에 실패했습니다", Toast.LENGTH_SHORT).show();
            }
        });
    }

    /** intent:// · kakaolink:// · kakaotalk:// · market:// 을 기기 앱으로 연다. 앱이 없으면 Play 스토어(또는 fallback 주소). */
    private boolean openExternalScheme(String url) {
        if (url == null) return false;
        try {
            if (url.startsWith("intent:")) {
                Intent i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException e) {
                    String fallback = i.getStringExtra("browser_fallback_url");
                    if (fallback != null) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(fallback)));
                    else if (i.getPackage() != null) openStore(i.getPackage());
                }
                return true;
            }
            if (url.startsWith("kakaolink:") || url.startsWith("kakaotalk:") || url.startsWith("kakaokompassauth:") || url.startsWith("market:")) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException e) {
                    openStore("com.kakao.talk");
                }
                return true;
            }
        } catch (Exception e) {
            Toast.makeText(this, "앱을 열 수 없습니다", Toast.LENGTH_SHORT).show();
            return true;
        }
        return false;
    }

    private void openStore(String pkg) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)));
        } catch (ActivityNotFoundException e) {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)));
        }
    }
}
