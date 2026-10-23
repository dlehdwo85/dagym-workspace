package kr.co.dagym.workos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 1.1.3 전체화면 알람: 예약한 시각이 되면 알람 알림을 띄운다(AlarmManager 알람 시계 → 이 수신기) */
public class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra("id", -1);
        WorkinAlarms.Alarm a = WorkinAlarms.find(context, id);
        if (a != null) WorkinAlarms.ring(context, a);
    }
}
