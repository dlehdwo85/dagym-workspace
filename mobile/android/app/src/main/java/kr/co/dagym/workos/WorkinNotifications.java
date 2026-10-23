package kr.co.dagym.workos;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 1.1.3 알림창 버튼: 서버 data(title·body·link·notificationId·actions·tag·channel)로 알림을 그린다.
 * - 알림을 누르면: 예전 FCM 알림처럼 MainActivity 에 google.message_id + data 를 넘겨 웹(native.ts)의 'tap' 처리(읽음·이동)를 그대로 쓴다.
 * - 버튼을 누르면: NotificationActionReceiver 가 앱을 열지 않고 /api/notifications/{id}/action 으로 처리한다(답글·수정 요청은 알림창에서 바로 입력).
 * - tag 는 서버가 주는 값(알림 id·업무 id), 번호는 0 — 예전 FCM 시스템 알림과 같은 규칙이라 같은 업무 알림은 겹치지 않고 바뀐다.
 */
final class WorkinNotifications {

    static final String KEY_TEXT = "wn_text";
    static final String ACTION_PREFIX = "kr.co.dagym.workos.NOTIF_ACTION.";
    private static final String TAP_PREFIX = "kr.co.dagym.workos.NOTIF_TAP.";
    private static final String WORK_CHANNEL = "work";
    private static final String ALARM_CHANNEL = "alarm_vibrate";
    private static final int MAX_ACTIONS = 3; // 안드로이드 알림 버튼은 최대 3개

    private WorkinNotifications() {}

    static void show(Context ctx, String messageId, Map<String, String> d) {
        if (!canPost(ctx)) return;
        String nid = nz(d.get("notificationId"), "");
        String tag = nz(d.get("tag"), nid.isEmpty() ? nz(messageId, "workin") : nid);
        boolean alarm = "true".equals(d.get("alarm"));
        String title = nz(d.get("title"), "워크인");
        String body = nz(d.get("body"), "");
        String channel = channelFor(ctx, alarm ? ALARM_CHANNEL : nz(d.get("channel"), WORK_CHANNEL));

        NotificationCompat.Builder b = base(ctx, channel)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(alarm ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(tapIntent(ctx, messageId, d, tag));

        JSONArray actions = parseArray(d.get("actions"));
        int added = 0;
        for (int i = 0; i < actions.length() && added < MAX_ACTIONS; i++) {
            JSONObject a = actions.optJSONObject(i);
            if (a == null) continue;
            String aid = a.optString("id", "");
            String label = a.optString("label", "");
            if (aid.isEmpty() || label.isEmpty()) continue;
            boolean input = "text".equals(a.optString("input", ""));
            Intent it = new Intent(ctx, NotificationActionReceiver.class)
                .setAction(ACTION_PREFIX + aid)
                .putExtra("nid", nid)
                .putExtra("action", aid)
                .putExtra("label", label)
                .putExtra("tag", tag)
                .putExtra("title", title)
                .putExtra("channel", channel)
                .putExtra("messageId", messageId)
                .putExtra("data", new JSONObject(d).toString());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (input ? mutableFlag() : PendingIntent.FLAG_IMMUTABLE);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, (tag + ":" + aid).hashCode(), it, flags);
            NotificationCompat.Action.Builder ab = new NotificationCompat.Action.Builder(0, label, pi);
            if (input) {
                ab.addRemoteInput(new RemoteInput.Builder(KEY_TEXT).setLabel("changes".equals(aid) ? "고칠 내용" : label).build());
                ab.setAllowGeneratedReplies(false);
            }
            b.addAction(ab.build());
            added++;
        }
        notifySafe(ctx, tag, b);
    }

    /** 버튼 처리 결과로 알림을 바꾼다: 성공 = '✓ 승인함'(몇 초 뒤 사라짐), 실패 = 이유 + 누르면 앱에서 열기 */
    static void showResult(Context ctx, Intent from, boolean ok, String message) {
        if (!canPost(ctx)) return;
        String tag = nz(from.getStringExtra("tag"), "workin");
        String title = nz(from.getStringExtra("title"), "워크인");
        String channel = channelFor(ctx, nz(from.getStringExtra("channel"), WORK_CHANNEL));
        NotificationCompat.Builder b = base(ctx, channel)
            .setContentTitle(ok ? "✓ " + message : "처리하지 못했습니다")
            .setContentText(ok ? title : message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(ok ? title : message + "\n" + title))
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(true);
        if (ok) {
            b.setTimeoutAfter(4000);
        } else {
            b.setContentIntent(tapIntent(ctx, from.getStringExtra("messageId"), dataOf(from), tag));
        }
        notifySafe(ctx, tag, b);
    }

    private static NotificationCompat.Builder base(Context ctx, String channel) {
        return new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_workin)
            .setColor(ContextCompat.getColor(ctx, R.color.workin_notification));
    }

    /** 누르면 앱으로: FirebaseMessaging 플러그인이 google.message_id 가 있는 intent 를 'notificationActionPerformed(tap)'으로 웹에 넘긴다 */
    private static PendingIntent tapIntent(Context ctx, String messageId, Map<String, String> d, String tag) {
        Intent i = new Intent(ctx, MainActivity.class)
            .setAction(TAP_PREFIX + tag)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra("google.message_id", messageId != null ? messageId : "wn:" + tag);
        for (Map.Entry<String, String> e : d.entrySet()) {
            if (e.getValue() != null) i.putExtra(e.getKey(), e.getValue());
        }
        return PendingIntent.getActivity(ctx, tag.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Map<String, String> dataOf(Intent from) {
        Map<String, String> m = new java.util.HashMap<>();
        try {
            JSONObject o = new JSONObject(nz(from.getStringExtra("data"), "{}"));
            java.util.Iterator<String> keys = o.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                m.put(k, o.optString(k, ""));
            }
        } catch (Exception ignored) {}
        return m;
    }

    /** 채널이 없으면: 업무 알림(work)은 만들고, 알람 채널은 웹이 소리·진동 설정으로 만들 때까지 업무 알림으로 보낸다 */
    private static String channelFor(Context ctx, String want) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return want;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return want;
        if (nm.getNotificationChannel(want) != null) return want;
        if (nm.getNotificationChannel(WORK_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(WORK_CHANNEL, "업무 알림", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("업무 배정·멘션·마감·검토·일정 변경 알림");
            nm.createNotificationChannel(ch);
        }
        return WORK_CHANNEL;
    }

    private static boolean canPost(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    private static void notifySafe(Context ctx, String tag, NotificationCompat.Builder b) {
        try {
            NotificationManagerCompat.from(ctx).notify(tag, 0, b.build());
        } catch (SecurityException ignored) {
            // 알림 권한이 그 사이에 꺼진 경우
        }
    }

    private static int mutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
    }

    private static JSONArray parseArray(String s) {
        try {
            return s == null || s.isEmpty() ? new JSONArray() : new JSONArray(s);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static String nz(String s, String fallback) {
        return s == null || s.isEmpty() ? fallback : s;
    }
}
