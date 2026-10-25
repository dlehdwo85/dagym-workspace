package kr.co.dagym.workos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;
import androidx.core.app.RemoteInput;
import com.getcapacitor.CapConfig;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * 1.1.3 알림창 버튼 처리: 앱을 열지 않고 웹 로그인 쿠키로 POST /api/notifications/{id}/action {action, text}.
 * 권한·상태 검사는 서버(notifActions.performAction)가 한다 — 남의 업무 승인 403, 이미 처리됨이면 그 결과를 돌려준다.
 * 결과는 같은 알림 자리에 '✓ 승인함' 또는 실패 이유로 바꿔 보여 준다(답글 입력 뒤 도는 표시도 이걸로 멈춘다).
 */
public class NotificationActionReceiver extends BroadcastReceiver {

    private static final String DEFAULT_SERVER = "https://www.work-in.dev";

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context ctx = context.getApplicationContext();
        final String nid = intent.getStringExtra("nid");
        final String action = intent.getStringExtra("action");
        if (nid == null || nid.isEmpty() || action == null || action.isEmpty()) return;
        String text = null;
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results != null) {
            CharSequence cs = results.getCharSequence(WorkinNotifications.KEY_TEXT);
            if (cs != null) text = cs.toString().trim();
        }
        final String base = serverUrl(ctx);
        // 웹뷰 쿠키는 메인 스레드에서 읽는다(onReceive 는 메인 스레드)
        String cookie = null;
        try {
            cookie = CookieManager.getInstance().getCookie(base);
        } catch (Exception ignored) {}
        final String sessionCookie = cookie;
        final String input = text;
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                handle(ctx, intent, base, sessionCookie, nid, action, input);
            } finally {
                pending.finish();
            }
        }, "workin-notif-action").start();
    }

    private static void handle(Context ctx, Intent intent, String base, String cookie, String nid, String action, String text) {
        if (cookie == null || cookie.isEmpty()) {
            WorkinNotifications.showResult(ctx, intent, false, "로그인이 필요합니다 — 눌러서 앱에서 열어 주세요");
            return;
        }
        HttpURLConnection c = null;
        try {
            URL url = new URL(base + "/api/notifications/" + URLEncoder.encode(nid, "UTF-8") + "/action");
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(12000);
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Cookie", cookie);
            c.setRequestProperty("User-Agent", "WorkInApp Notification");
            JSONObject body = new JSONObject();
            body.put("action", action);
            if (text != null && !text.isEmpty()) body.put("text", text);
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            JSONObject res = readJson(code < 400 ? c.getInputStream() : c.getErrorStream());
            if (code >= 200 && code < 300) {
                String label = res != null ? res.optString("label", "") : "";
                WorkinNotifications.showResult(ctx, intent, true, label.isEmpty() ? WorkinNotifications.nz(intent.getStringExtra("label"), "처리") + " 완료" : label);
            } else if (code == 401) {
                WorkinNotifications.showResult(ctx, intent, false, "로그인이 필요합니다 — 눌러서 앱에서 열어 주세요");
            } else {
                String msg = null;
                if (res != null && res.optJSONObject("error") != null) msg = res.optJSONObject("error").optString("message", null);
                WorkinNotifications.showResult(ctx, intent, false, msg != null && !msg.isEmpty() ? msg : "눌러서 앱에서 처리해 주세요");
            }
        } catch (Exception e) {
            WorkinNotifications.showResult(ctx, intent, false, "연결이 불안정합니다 — 눌러서 앱에서 처리해 주세요");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** 앱이 불러오는 운영 주소(capacitor.config 의 server.url) — 웹뷰 로그인 쿠키가 이 주소에 있다 */
    private static String serverUrl(Context ctx) {
        try {
            String u = CapConfig.loadDefault(ctx).getServerUrl();
            if (u != null && u.startsWith("http")) return u.replaceAll("/+$", "");
        } catch (Exception ignored) {}
        return DEFAULT_SERVER;
    }

    private static JSONObject readJson(InputStream in) {
        if (in == null) return null;
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0 && out.size() < 65536) out.write(buf, 0, n);
            return new JSONObject(out.toString("UTF-8"));
        } catch (Exception e) {
            return null;
        }
    }
}
