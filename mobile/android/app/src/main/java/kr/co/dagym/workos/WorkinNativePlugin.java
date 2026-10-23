package kr.co.dagym.workos;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 웹(native.ts)이 이 앱 빌드가 할 수 있는 네이티브 기능을 묻는 곳. 푸시 토큰 등록 때 caps 를 함께 보내면
 * 서버가 'android-actions-1' 앱에만 data 전용 알림(앱이 버튼을 그림)을 보낸다 — 옛 앱(1.1.2 이하)은 지금처럼 시스템 알림.
 */
@CapacitorPlugin(name = "WorkinNative")
public class WorkinNativePlugin extends Plugin {

    static final String[] CAPS = { "android-actions-1" };

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject r = new JSObject();
        JSArray caps = new JSArray();
        for (String c : CAPS) caps.put(c);
        r.put("platform", "android");
        r.put("caps", caps);
        call.resolve(r);
    }
}
