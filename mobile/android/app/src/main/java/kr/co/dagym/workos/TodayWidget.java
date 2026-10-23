package kr.co.dagym.workos;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.view.View;
import android.webkit.CookieManager;
import android.widget.RemoteViews;
import com.getcapacitor.CapConfig;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 1.1.3 바탕화면 위젯 '워크인 오늘'(대표 #110): 서버 /api/widget/today(내 담당 오늘·지난 업무 5·남은 일정·수)를 웹뷰 로그인 쿠키로 불러 그린다.
 * - 줄을 누르면 그 업무, ○ 를 누르면 완료(/api/widget/tasks/{id}/done — 검토 필요 업무는 검토 요청), [+] 새 업무, ↻ 새로고침.
 * - 30분마다(시스템) + 앱을 열 때(WorkinNative.refreshWidget) 새로 고친다. 마지막 응답은 기기에 저장해 바로 그린다.
 */
public class TodayWidget extends AppWidgetProvider {

    static final String ACTION_REFRESH = "kr.co.dagym.workos.WIDGET_REFRESH";
    private static final String ACTION_DONE = "kr.co.dagym.workos.WIDGET_DONE";
    private static final String PREFS = "workin_widget";
    private static final String DEFAULT_SERVER = "https://work-in.dev";
    private static final int[] ROWS = { R.id.w_row0, R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4 };
    private static final int[] CHECKS = { R.id.w_check0, R.id.w_check1, R.id.w_check2, R.id.w_check3, R.id.w_check4 };
    private static final int[] TITLES = { R.id.w_title0, R.id.w_title1, R.id.w_title2, R.id.w_title3, R.id.w_title4 };
    private static final int[] DUES = { R.id.w_due0, R.id.w_due1, R.id.w_due2, R.id.w_due3, R.id.w_due4 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context, cached(context), null);
        refreshAsync(context, null, null);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (ACTION_REFRESH.equals(a)) {
            refreshAsync(context, null, goAsync());
            return;
        }
        if (ACTION_DONE.equals(a)) {
            String id = intent.getStringExtra("id");
            if (id != null) refreshAsync(context, id, goAsync());
            return;
        }
        super.onReceive(context, intent);
    }

    /** 앱(웹)에서 저장·로그인했을 때 위젯 새로고침 — WorkinNative.refreshWidget() */
    static void requestRefresh(Context ctx) {
        ctx.sendBroadcast(new Intent(ctx, TodayWidget.class).setAction(ACTION_REFRESH));
    }

    private static void refreshAsync(Context context, String doneId, PendingResult pending) {
        final Context ctx = context.getApplicationContext();
        int[] ids = AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, TodayWidget.class));
        if (ids == null || ids.length == 0) { // 위젯을 두지 않았으면 불러오지 않음
            if (pending != null) pending.finish();
            return;
        }
        final String base = serverUrl(ctx);
        String cookie = null;
        try {
            cookie = CookieManager.getInstance().getCookie(base); // 메인 스레드에서 읽기
        } catch (Exception ignored) {}
        final String sessionCookie = cookie;
        new Thread(() -> {
            try {
                if (sessionCookie == null || sessionCookie.isEmpty()) {
                    render(ctx, null, "앱에서 로그인하면 오늘 할 일이 보입니다");
                    return;
                }
                if (doneId != null) request(base + "/api/widget/tasks/" + URLEncoder.encode(doneId, "UTF-8") + "/done", "POST", sessionCookie);
                Object[] res = request(base + "/api/widget/today", "GET", sessionCookie);
                int code = (Integer) res[0];
                if (code == 200 && res[1] != null) {
                    String json = (String) res[1];
                    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("today", json).putLong("at", System.currentTimeMillis()).apply();
                    render(ctx, new JSONObject(json), null);
                } else if (code == 401) {
                    render(ctx, null, "앱에서 로그인하면 오늘 할 일이 보입니다");
                } else {
                    render(ctx, cached(ctx), "새로 고치지 못했습니다 — 잠시 뒤 다시");
                }
            } catch (Exception e) {
                render(ctx, cached(ctx), "연결이 불안정합니다");
            } finally {
                if (pending != null) pending.finish();
            }
        }, "workin-widget").start();
    }

    private static JSONObject cached(Context ctx) {
        try {
            String s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("today", null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static void render(Context ctx, JSONObject d, String notice) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, TodayWidget.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        SimpleDateFormat md = new SimpleDateFormat("M월 d일 (E)", Locale.KOREA);
        md.setTimeZone(TimeZone.getTimeZone("Asia/Seoul"));
        v.setTextViewText(R.id.w_date, md.format(new Date()));
        v.setOnClickPendingIntent(R.id.w_header, open(ctx, "/", 1));
        v.setOnClickPendingIntent(R.id.w_add, open(ctx, "/tasks?new=1", 2));
        v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 3,
            new Intent(ctx, TodayWidget.class).setAction(ACTION_REFRESH), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        JSONObject counts = d != null ? d.optJSONObject("counts") : null;
        v.setTextViewText(R.id.w_counts, counts == null ? "" : "지남 " + counts.optInt("late") + " · 오늘 " + counts.optInt("today") + " · 승인 " + counts.optInt("approvals"));
        v.setTextColor(R.id.w_counts, counts != null && counts.optInt("late") > 0 ? Color.parseColor("#B91C1C") : Color.parseColor("#475569"));

        JSONArray tasks = d != null ? d.optJSONArray("tasks") : null;
        int n = tasks == null ? 0 : Math.min(tasks.length(), ROWS.length);
        for (int i = 0; i < ROWS.length; i++) {
            if (i >= n) {
                v.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            JSONObject t = tasks.optJSONObject(i);
            String id = t.optString("id");
            boolean done = t.optBoolean("done");
            boolean late = t.optBoolean("late");
            v.setViewVisibility(ROWS[i], View.VISIBLE);
            v.setTextViewText(CHECKS[i], done ? "✓" : "○");
            v.setTextColor(CHECKS[i], Color.parseColor(done ? "#0F766E" : "#94A3B8"));
            v.setTextViewText(TITLES[i], t.optString("title"));
            v.setTextColor(TITLES[i], Color.parseColor(done ? "#94A3B8" : "#0F172A"));
            v.setTextViewText(DUES[i], t.optString("due"));
            v.setTextColor(DUES[i], Color.parseColor(late ? "#B91C1C" : "#64748B"));
            v.setOnClickPendingIntent(ROWS[i], open(ctx, "/tasks/" + id, 100 + i));
            v.setOnClickPendingIntent(CHECKS[i], PendingIntent.getBroadcast(ctx, 200 + i,
                new Intent(ctx, TodayWidget.class).setAction(ACTION_DONE).putExtra("id", id), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        String empty = notice != null && d == null ? notice : (n == 0 ? "오늘 할 일이 없습니다" : null);
        v.setViewVisibility(R.id.w_empty, empty != null ? View.VISIBLE : View.GONE);
        if (empty != null) v.setTextViewText(R.id.w_empty, empty);

        JSONObject next = d != null ? d.optJSONObject("next") : null;
        String foot = next != null ? "다음 일정 " + next.optString("time") + " " + next.optString("title") : "";
        if (notice != null && d != null) foot = notice;
        v.setTextViewText(R.id.w_next, foot);
        v.setViewVisibility(R.id.w_next, foot.isEmpty() ? View.GONE : View.VISIBLE);
        m.updateAppWidget(ids, v);
    }

    private static PendingIntent open(Context ctx, String path, int req) {
        return PendingIntent.getActivity(ctx, req, WorkinAlarms.openAppIntent(ctx, path), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** [code, body] */
    private static Object[] request(String url, String method, String cookie) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(8000);
            c.setReadTimeout(10000);
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod(method);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Cookie", cookie);
            c.setRequestProperty("User-Agent", "WorkInApp Widget");
            if ("POST".equals(method)) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.getOutputStream().write("{}".getBytes("UTF-8"));
            }
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            String body = null;
            if (in != null) {
                try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[4096];
                    int k;
                    while ((k = is.read(buf)) > 0 && out.size() < 65536) out.write(buf, 0, k);
                    body = out.toString("UTF-8");
                }
            }
            return new Object[] { code, body };
        } finally {
            c.disconnect();
        }
    }

    private static String serverUrl(Context ctx) {
        try {
            String u = CapConfig.loadDefault(ctx).getServerUrl();
            if (u != null && u.startsWith("http")) return u.replaceAll("/+$", "");
        } catch (Exception ignored) {}
        return DEFAULT_SERVER;
    }
}
