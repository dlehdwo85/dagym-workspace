package kr.co.dagym.workos;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * 1.1.3 전체화면 알람 화면(대표 #447): 잠금 화면 위에 시각·제목과 큰 [해제]·[n분 뒤] 버튼, 진동은 1분까지.
 * 버튼은 알림 버튼과 같은 처리(WorkinAlarms.act). [워크인에서 열기]는 알람을 끄고 그 업무·일정 화면으로.
 */
public class AlarmActivity extends AppCompatActivity {

    private static final long VIBRATE_MAX_MS = 60_000;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Vibrator vibrator;
    private int alarmId = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        setContentView(R.layout.activity_alarm);
        bind(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        bind(intent);
    }

    private void bind(Intent intent) {
        alarmId = intent.getIntExtra("id", -1);
        WorkinAlarms.Alarm a = WorkinAlarms.find(this, alarmId);
        if (a == null) {
            finish();
            return;
        }
        SimpleDateFormat hm = new SimpleDateFormat("a h:mm", Locale.KOREA);
        hm.setTimeZone(TimeZone.getTimeZone("Asia/Seoul"));
        ((TextView) findViewById(R.id.alarm_time)).setText(hm.format(new Date(Math.max(a.at, System.currentTimeMillis() - 3600_000L))));
        ((TextView) findViewById(R.id.alarm_title)).setText(a.title);
        TextView body = findViewById(R.id.alarm_body);
        body.setText(a.body);
        body.setVisibility(a.body.isEmpty() ? TextView.GONE : TextView.VISIBLE);
        Button snooze = findViewById(R.id.alarm_snooze);
        snooze.setText(a.snoozeMinutes + "분 뒤 다시 알림");
        findViewById(R.id.alarm_dismiss).setOnClickListener(v -> finishWith("dismiss", null));
        snooze.setOnClickListener(v -> finishWith("snooze", null));
        findViewById(R.id.alarm_open).setOnClickListener(v -> finishWith("open", a.link));
        startVibration();
    }

    private void finishWith(String action, String openLink) {
        stopVibration();
        WorkinAlarms.act(getApplicationContext(), alarmId, action, null);
        if (openLink != null) startActivity(WorkinAlarms.openAppIntent(this, openLink));
        finish();
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void startVibration() {
        stopVibration();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] pattern = { 0, 800, 600 };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        else vibrator.vibrate(pattern, 0);
        handler.postDelayed(this::stopVibration, VIBRATE_MAX_MS);
    }

    private void stopVibration() {
        handler.removeCallbacksAndMessages(null);
        if (vibrator != null) vibrator.cancel();
    }

    @Override
    protected void onDestroy() {
        stopVibration();
        super.onDestroy();
    }
}
