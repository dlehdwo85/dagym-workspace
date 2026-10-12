package kr.co.dagym.workos;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
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
    }
}
