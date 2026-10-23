package kr.co.dagym.workos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 1.1.3 전체화면 알람: 휴대폰을 다시 켜거나 앱을 업데이트하면 AlarmManager 예약이 사라지므로 저장해 둔 알람을 다시 예약한다 */
public class AlarmBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            WorkinAlarms.rescheduleAll(context);
        }
    }
}
