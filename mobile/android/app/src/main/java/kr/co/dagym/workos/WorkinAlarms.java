package kr.co.dagym.workos;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.CapConfig;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 1.1.3 전체화면 알람(대표 #447 "휴대폰 알람처럼 전체 화면에 띄우고 해제"): 웹이 setAlarms 로 넘긴 알람을 AlarmManager 알람 시계로 예약하고,
 * 울리면 전체화면 알림(잠금 화면이면 AlarmActivity, 쓰는 중이면 머리 위 알림 + [해제][10분 뒤])을 띄운다.
 * 결과는 웹과 같은 POST /api/reminders/alarm {kind, id, action, minutes, key} 로 서버에 알린다(웹뷰 로그인 쿠키).
 * 목록은 기기에 저장해 재부팅·앱 업데이트 뒤 다시 예약한다.
 */
final class WorkinAlarms {

    static final String CHANNEL = "alarm_vibrate";
    static final String NOTIF_TAG = "workin-alarm";
    private static final String PREFS = "workin_alarms";
    private static final String KEY_LIST = "alarms";
    private static final String FIRE_ACTION = "kr.co.dagym.workos.ALARM_FIRE";
    private static final String DEFAULT_SERVER = "https://work-in.dev";
    private static final long KEEP_FIRED_MS = 6 * 3600_000L; // 울린 알람은 6시간 뒤 목록에서 정리

    private WorkinAlarms() {}

    static final class Alarm {
        int id;
        String key = "";
        long at;
        String title = "알람";
        String body = "";
        String link = "/";
        String kind = "";
        String entityId = "";
        int snoozeMinutes = 10;
        int snoozed = 0;

        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("id", id).put("key", key).put("at", at).put("title", title).put("body", body).put("link", link)
                    .put("kind", kind).put("entityId", entityId).put("snoozeMinutes", snoozeMinutes).put("snoozed", snoozed);
            } catch (Exception ignored) {}
            return o;
        }

        static Alarm fromJson(JSONObject o) {
            Alarm a = new Alarm();
            a.id = o.optInt("id");
            a.key = o.optString("key", "");
            a.at = o.optLong("at");
            a.title = o.optString("title", "알람");
            a.body = o.optString("body", "");
            a.link = o.optString("link", "/");
            a.kind = o.optString("kind", "");
            a.entityId = o.optString("entityId", "");
            a.snoozeMinutes = Math.max(1, Math.min(120, o.optInt("snoozeMinutes", 10)));
            a.snoozed = o.optInt("snoozed", 0);
            return a;
        }
    }

    // ── 저장 ──────────────────────────────────────────────

    static synchronized List<Alarm> load(Context ctx) {
        List<Alarm> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString(KEY_LIST, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null) out.add(Alarm.fromJson(o));
            }
        } catch (Exception ignored) {}
        return out;
    }

    static synchronized void save(Context ctx, List<Alarm> list) {
        JSONArray arr = new JSONArray();
        for (Alarm a : list) arr.put(a.toJson());
        prefs(ctx).edit().putString(KEY_LIST, arr.toString()).apply();
    }

    static Alarm find(Context ctx, int id) {
        for (Alarm a : load(ctx)) if (a.id == id) return a;
        return null;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── 예약 ──────────────────────────────────────────────

    /** 웹이 준 목록으로 바꾼다: 앞으로 울릴 웹 알람은 새 목록으로, [10분 뒤]로 다시 맞춘 알람(snoozed)과 방금 울린 알람은 남긴다 */
    static synchronized void replaceAll(Context ctx, List<Alarm> fresh) {
        long now = System.currentTimeMillis();
        List<Alarm> keep = new ArrayList<>();
        for (Alarm a : load(ctx)) {
            if (a.snoozed > 0 && a.at > now - KEEP_FIRED_MS) keep.add(a);
            else if (a.at <= now && a.at > now - KEEP_FIRED_MS) keep.add(a);
            else if (a.at > now) cancelSchedule(ctx, a.id);
        }
        for (Alarm a : fresh) {
            if (a.at <= now) continue;
            removeById(keep, a.id);
            keep.add(a);
            schedule(ctx, a);
        }
        save(ctx, keep);
    }

    static synchronized void add(Context ctx, Alarm a) {
        List<Alarm> list = load(ctx);
        removeById(list, a.id);
        list.add(a);
        save(ctx, list);
        schedule(ctx, a);
    }

    static synchronized void remove(Context ctx, int id) {
        List<Alarm> list = load(ctx);
        removeById(list, id);
        save(ctx, list);
        cancelSchedule(ctx, id);
    }

    /** 재부팅·앱 업데이트 뒤: 앞으로 울릴 알람 다시 예약 */
    static void rescheduleAll(Context ctx) {
        long now = System.currentTimeMillis();
        for (Alarm a : load(ctx)) if (a.at > now) schedule(ctx, a);
    }

    /** 앱 안 알람 띠에서 [해제]/[10분 뒤]를 눌렀을 때: 같은 업무·일정의 울리는(이미 지난) 알람 알림을 지운다 */
    static synchronized void settle(Context ctx, String entityId) {
        if (entityId == null || entityId.isEmpty()) return;
        long now = System.currentTimeMillis();
        List<Alarm> list = load(ctx);
        List<Alarm> keep = new ArrayList<>();
        for (Alarm a : list) {
            if (entityId.equals(a.entityId) && a.at <= now + 60_000) {
                NotificationManagerCompat.from(ctx).cancel(NOTIF_TAG, a.id);
                cancelSchedule(ctx, a.id);
            } else keep.add(a);
        }
        save(ctx, keep);
    }

    static void schedule(Context ctx, Alarm a) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        PendingIntent fire = firePI(ctx, a.id, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, fire);
                return;
            }
            PendingIntent show = PendingIntent.getActivity(ctx, a.id, openAppIntent(ctx, a.link), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(a.at, show), fire);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, fire);
        }
    }

    static void cancelSchedule(Context ctx, int id) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        PendingIntent pi = firePI(ctx, id, PendingIntent.FLAG_NO_CREATE);
        if (am != null && pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }

    private static PendingIntent firePI(Context ctx, int id, int flags) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(FIRE_ACTION).putExtra("id", id);
        return PendingIntent.getBroadcast(ctx, id, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    // ── 울리기 ────────────────────────────────────────────

    /** 전체화면 알림: 잠금·화면 꺼짐이면 시스템이 AlarmActivity 를 띄우고, 쓰는 중이면 머리 위 알림(버튼 포함) */
    static void ring(Context ctx, Alarm a) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        ensureChannel(ctx);
        Intent full = new Intent(ctx, AlarmActivity.class)
            .putExtra("id", a.id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        PendingIntent fullPI = PendingIntent.getActivity(ctx, a.id, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_workin)
            .setColor(ContextCompat.getColor(ctx, R.color.workin_notification))
            .setContentTitle(a.title)
            .setContentText(a.body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(a.body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullPI, true)
            .setContentIntent(fullPI)
            .addAction(0, "해제", actionPI(ctx, a.id, "dismiss"))
            .addAction(0, a.snoozeMinutes + "분 뒤", actionPI(ctx, a.id, "snooze"));
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIF_TAG, a.id, b.build());
        } catch (SecurityException ignored) {}
    }

    private static PendingIntent actionPI(Context ctx, int id, String action) {
        Intent i = new Intent(ctx, AlarmActionReceiver.class).setAction("kr.co.dagym.workos.ALARM_" + action).putExtra("id", id).putExtra("action", action);
        return PendingIntent.getBroadcast(ctx, (id + ":" + action).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * [해제]/[10분 뒤]/[열기] — 알림 버튼·전체화면 화면 공용. 메인 스레드에서 부른다(웹뷰 쿠키 읽기). done 은 서버 알림까지 끝나면 불린다.
     * 열기는 서버에 알리지 않는다(웹 alarmAction 'open' 과 같음).
     */
    static void act(Context ctx, int id, String action, Runnable done) {
        NotificationManagerCompat.from(ctx).cancel(NOTIF_TAG, id);
        Alarm a = find(ctx, id);
        if (a == null) {
            if (done != null) done.run();
            return;
        }
        remove(ctx, id);
        if ("snooze".equals(action)) {
            Alarm s = Alarm.fromJson(a.toJson());
            s.id = (int) (System.currentTimeMillis() / 1000 % 1_000_000_000) + 1_000_000_000;
            s.at = System.currentTimeMillis() + a.snoozeMinutes * 60_000L;
            s.snoozed = a.snoozed + 1;
            add(ctx, s);
        }
        if ("open".equals(action) || a.kind.isEmpty() || a.entityId.isEmpty()) {
            if (done != null) done.run();
            return;
        }
        final String base = serverUrl(ctx);
        String cookie = null;
        try {
            cookie = CookieManager.getInstance().getCookie(base);
        } catch (Exception ignored) {}
        final String sessionCookie = cookie;
        new Thread(() -> {
            try {
                report(base, sessionCookie, a, action);
            } finally {
                if (done != null) done.run();
            }
        }, "workin-alarm-report").start();
    }

    private static void report(String base, String cookie, Alarm a, String action) {
        if (cookie == null || cookie.isEmpty()) return;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/api/reminders/alarm").openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(10000);
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("Cookie", cookie);
            c.setRequestProperty("User-Agent", "WorkInApp Alarm");
            JSONObject body = new JSONObject();
            body.put("kind", a.kind).put("id", a.entityId).put("action", action);
            if ("snooze".equals(action)) body.put("minutes", a.snoozeMinutes);
            if (!a.key.isEmpty()) body.put("key", a.key.length() > 200 ? a.key.substring(0, 200) : a.key);
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            c.getResponseCode();
        } catch (Exception ignored) {
            // 서버 알림 실패해도 기기 알람 처리는 끝난 상태
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** 알람 채널이 아직 없으면(웹이 만들기 전) 웹과 같은 설정으로 만든다: 무음 파일 + 진동 + 잠금 화면에 보이기 */
    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "알람(진동)", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("알람처럼 울리는 일정·마감 — 소리 없이 진동");
        ch.enableVibration(true);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        Uri silence = Uri.parse("android.resource://" + ctx.getPackageName() + "/" + R.raw.silence);
        ch.setSound(silence, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        nm.createNotificationChannel(ch);
    }

    /** 앱에서 그 화면 열기: workos://app/<link> → 웹 native.ts 의 appUrlOpen 이 이동 */
    static Intent openAppIntent(Context ctx, String link) {
        String path = link != null && link.startsWith("/") ? link : "/";
        return new Intent(Intent.ACTION_VIEW, Uri.parse("workos://app" + path))
            .setClass(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    static boolean canFullScreen(Context ctx) {
        if (Build.VERSION.SDK_INT < 34) return true;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        return nm != null && nm.canUseFullScreenIntent();
    }

    static boolean canExact(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        return am != null && am.canScheduleExactAlarms();
    }

    private static String serverUrl(Context ctx) {
        try {
            String u = CapConfig.loadDefault(ctx).getServerUrl();
            if (u != null && u.startsWith("http")) return u.replaceAll("/+$", "");
        } catch (Exception ignored) {}
        return DEFAULT_SERVER;
    }

    private static void removeById(List<Alarm> list, int id) {
        for (int i = list.size() - 1; i >= 0; i--) if (list.get(i).id == id) list.remove(i);
    }
}
