package kr.co.dagym.workos;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * 웹(native.ts)이 이 앱 빌드의 네이티브 기능을 쓰는 곳.
 * - getInfo(): caps — 푸시 토큰 등록 때 함께 보내면 서버가 'android-actions-1' 앱에만 data 전용 알림(앱이 버튼을 그림)을 보낸다.
 * - setAlarms/addAlarm/settleAlarm/alarmStatus/openAlarmSettings: 전체화면 알람('android-fullscreen-alarm-1') — 알람은 LocalNotifications 대신 여기로.
 * 옛 앱(1.1.2 이하)에는 이 플러그인이 없으니 웹은 Capacitor.isPluginAvailable('WorkinNative') 로 확인하고 지금 방식을 쓴다.
 */
@CapacitorPlugin(name = "WorkinNative")
public class WorkinNativePlugin extends Plugin {

    static final String[] CAPS = { "android-actions-1", "android-fullscreen-alarm-1" };

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject r = new JSObject();
        JSArray caps = new JSArray();
        for (String c : CAPS) caps.put(c);
        r.put("platform", "android");
        r.put("caps", caps);
        call.resolve(r);
    }

    /** 앞으로 울릴 알람 전체를 이 목록으로 바꾼다: alarms = [{id, at(ms), title, body, link, kind, entityId, key, snoozeMinutes}] */
    @PluginMethod
    public void setAlarms(PluginCall call) {
        JSArray arr = call.getArray("alarms");
        List<WorkinAlarms.Alarm> list = new ArrayList<>();
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && o.optLong("at") > 0) list.add(WorkinAlarms.Alarm.fromJson(o));
            }
        }
        WorkinAlarms.replaceAll(getContext(), list);
        JSObject r = new JSObject();
        r.put("scheduled", list.size());
        call.resolve(r);
    }

    /** 알람 하나 더(앱 안 띠의 [10분 뒤] 등) */
    @PluginMethod
    public void addAlarm(PluginCall call) {
        JSObject o = call.getData();
        if (o.optLong("at") <= 0) {
            call.reject("at 이 필요합니다");
            return;
        }
        WorkinAlarms.Alarm a = WorkinAlarms.Alarm.fromJson(o);
        if (a.snoozed == 0 && o.optBoolean("snooze", false)) a.snoozed = 1;
        WorkinAlarms.add(getContext(), a);
        call.resolve();
    }

    /** 앱 안 알람 띠에서 [해제]/[10분 뒤]를 눌렀을 때: 그 업무·일정의 울리는 알람 알림을 지운다 */
    @PluginMethod
    public void settleAlarm(PluginCall call) {
        WorkinAlarms.settle(getContext(), call.getString("entityId", ""));
        call.resolve();
    }

    /** 전체화면 허용(Android 14+ 설정)·정확한 시각 예약 가능 여부 */
    @PluginMethod
    public void alarmStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("fullScreen", WorkinAlarms.canFullScreen(getContext()));
        r.put("exact", WorkinAlarms.canExact(getContext()));
        r.put("count", WorkinAlarms.load(getContext()).size());
        call.resolve(r);
    }

    /** '전체화면 알람 허용' 설정 화면 열기(Android 14+), 그 아래는 앱 알림 설정 */
    @PluginMethod
    public void openAlarmSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent i;
        if (Build.VERSION.SDK_INT >= 34) {
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + pkg));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("설정 화면을 열 수 없습니다");
        }
    }
}
