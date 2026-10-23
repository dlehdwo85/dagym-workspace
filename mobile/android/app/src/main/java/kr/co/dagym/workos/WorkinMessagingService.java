package kr.co.dagym.workos;

import android.app.ActivityManager;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.MessagingService;
import java.util.Map;

/**
 * 1.1.3 알림창 버튼(대표 #130·#478): 이 앱(caps 'android-actions-1')에는 서버가 notification 없이 data 만 보낸다(wn=1).
 * notification 이 없으면 앱이 꺼져 있어도 여기로 오므로, 승인·수정 요청·답글·확인 버튼이 달린 알림을 앱이 직접 그린다.
 * 앱을 보고 있을 때는 그리지 않는다(예전 FCM 알림과 같음 — 웹 화면이 새로고침으로 보여 준다).
 * 플러그인(MessagingService)의 토큰·JS 전달은 super 로 그대로 둔다.
 */
public class WorkinMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> d = message.getData();
        if ("1".equals(d.get("wn")) && message.getNotification() == null && !inForeground()) {
            try {
                WorkinNotifications.show(this, message.getMessageId(), d);
            } catch (Exception ignored) {
                // 알림 한 건을 못 그려도 앱이 죽지 않게
            }
        }
        super.onMessageReceived(message);
    }

    private static boolean inForeground() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
    }
}
