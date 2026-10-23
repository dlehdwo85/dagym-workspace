package kr.co.dagym.workos;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.provider.Telephony;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * 웹(native.ts)이 이 앱 빌드의 네이티브 기능을 쓰는 곳.
 * - getInfo(): caps — 푸시 토큰 등록 때 함께 보내면 서버가 'android-actions-1' 앱에만 data 전용 알림(앱이 버튼을 그림)을 보낸다.
 * - setAlarms/addAlarm/settleAlarm/alarmStatus/openAlarmSettings: 전체화면 알람('android-fullscreen-alarm-1') — 알람은 LocalNotifications 대신 여기로.
 * - refreshWidget: 바탕화면 위젯('android-widget-1') 새로고침 — 앱을 열 때·업무를 저장했을 때.
 * - shareToSms: 문자에 파일 바로 첨부('android-sms-attach-1') — 기본 문자 앱을 받는 번호·본문·파일을 채워 연다.
 * 옛 앱(1.1.2 이하)에는 이 플러그인이 없으니 웹은 Capacitor.isPluginAvailable('WorkinNative') 로 확인하고 지금 방식을 쓴다.
 */
@CapacitorPlugin(name = "WorkinNative")
public class WorkinNativePlugin extends Plugin {

    static final String[] CAPS = { "android-actions-1", "android-fullscreen-alarm-1", "android-widget-1", "android-sms-attach-1" };

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

    /** 바탕화면 위젯 새로고침(위젯이 없으면 아무것도 안 함) */
    @PluginMethod
    public void refreshWidget(PluginCall call) {
        TodayWidget.requestRefresh(getContext());
        call.resolve();
    }

    /**
     * 대표 #183 7-3 "자료 내려받기 주소 말고 파일 직접": 기본 문자 앱을 번호·본문·첨부 파일로 채워 연다(보내기는 사람이 누름).
     * files = [{ uri: Filesystem.writeFile(CACHE) 가 준 file:// 주소, mime }] — 앱 캐시 폴더 파일만 받는다.
     * 기본 문자 앱이 첨부를 못 받으면 공유 창으로 연다. 큰 파일은 문자 앱·통신사 규칙(MMS·RCS)에 따라 줄이거나 못 보낼 수 있다.
     */
    @PluginMethod
    public void shareToSms(PluginCall call) {
        JSArray phones = call.getArray("phones");
        String body = call.getString("body", "");
        JSArray files = call.getArray("files");
        String cacheRoot = getContext().getCacheDir().getAbsolutePath();
        ArrayList<Uri> uris = new ArrayList<>();
        String mime = null;
        try {
            if (files != null) {
                for (int i = 0; i < files.length(); i++) {
                    JSONObject f = files.optJSONObject(i);
                    if (f == null) continue;
                    String raw = f.optString("uri", "");
                    File file = new File(raw.startsWith("file://") ? Uri.parse(raw).getPath() : raw);
                    if (!file.isFile() || !file.getCanonicalPath().startsWith(cacheRoot)) continue;
                    uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file));
                    String m = f.optString("mime", "*/*");
                    mime = mime == null ? m : (mime.equals(m) ? mime : "*/*");
                }
            }
        } catch (Exception e) {
            call.reject("첨부 파일을 읽지 못했습니다");
            return;
        }
        StringBuilder to = new StringBuilder();
        if (phones != null) {
            for (int i = 0; i < phones.length(); i++) {
                String p = phones.optString(i, "").replaceAll("[^0-9+]", "");
                if (p.isEmpty()) continue;
                if (to.length() > 0) to.append(';');
                to.append(p);
            }
        }
        Intent i;
        if (uris.isEmpty()) {
            i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + to));
        } else if (uris.size() == 1) {
            i = new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris.get(0)).setType(mime);
        } else {
            i = new Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris).setType(mime);
        }
        i.putExtra("sms_body", body).putExtra(Intent.EXTRA_TEXT, body).putExtra("address", to.toString());
        if (!uris.isEmpty()) {
            ClipData clip = ClipData.newRawUri("", uris.get(0));
            for (int k = 1; k < uris.size(); k++) clip.addItem(new ClipData.Item(uris.get(k)));
            i.setClipData(clip);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String smsApp = Telephony.Sms.getDefaultSmsPackage(getContext());
        JSObject r = new JSObject();
        try {
            if (smsApp != null) {
                try { // 패키지 조회 제한(Android 11+) 때문에 resolveActivity 대신 바로 열어 보고, 못 열면 공유 창
                    getContext().startActivity(new Intent(i).setPackage(smsApp));
                    r.put("app", smsApp);
                    r.put("attached", uris.size());
                    call.resolve(r);
                    return;
                } catch (android.content.ActivityNotFoundException ignored) {}
            }
            getContext().startActivity(Intent.createChooser(i, "문자 보내기").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            r.put("app", "chooser");
            r.put("attached", uris.size());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("문자 앱을 열 수 없습니다");
        }
    }
}
