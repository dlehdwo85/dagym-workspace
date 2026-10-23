package kr.co.dagym.workos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 1.1.3 전체화면 알람: 알림의 [해제]/[n분 뒤] 버튼 — 앱을 열지 않고 처리하고 서버에 알린다 */
public class AlarmActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra("id", -1);
        String action = intent.getStringExtra("action");
        if (id < 0 || action == null) return;
        final PendingResult pending = goAsync();
        WorkinAlarms.act(context.getApplicationContext(), id, action, pending::finish);
    }
}
