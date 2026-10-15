package kr.co.dagym.workos;

import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

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
}
