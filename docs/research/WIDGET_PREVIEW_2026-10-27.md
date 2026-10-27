# 바탕화면 위젯 '워크인 오늘' — 고르기·추가 창 미리보기가 비어 보임 (대표 10/27)

대표 캡처(삼성 휴대폰, 앱 업무 화면 → '홈 화면에 추가' 창): 미리보기 카드에 ↻·[+] 두 단추만 있고 내용이 비어 있음 — "예시가 안보이네요".

## 원인

- `mobile/android/app/src/main/res/xml/widget_today_info.xml` 의 `android:previewLayout="@layout/widget_today"` — 미리보기가 **실제 위젯 틀 그대로**.
- 실제 틀(`widget_today.xml`)은 날짜·수 칸이 비어 있고 할 일 5줄·다음 일정이 모두 `gone` — 내용은 위젯을 놓은 뒤 `TodayWidget.render()` 가 서버(`/api/widget/today`)에서 불러와 채운다.
- 고르기·추가 창은 `render()` 를 부르지 않으므로 빈 틀만 보인다. (Android 12 이상은 previewLayout, 8~11 은 `previewImage` 가 없어 앱 아이콘이 보임)
- 위젯을 놓은 뒤에는 날짜와 내 할 일이 정상으로 채워짐(이번 지적과 무관).

## 고칠 것 (네이티브 — 로컬 담당, 다음 앱 빌드 1.1.4)

1. **새 파일** `mobile/android/app/src/main/res/layout/widget_today_preview.xml` — 실제 위젯과 같은 모양에 예시 글자(회사·사람 이름 없음). 아래 전체 내용 그대로.
2. `widget_today_info.xml` 한 줄: `android:previewLayout="@layout/widget_today_preview"` (Android 12+ 고르기 창·추가 창).
3. `WorkinNativePlugin.requestPinWidget` — 앱의 [위젯 추가] 단추가 여는 창에도 같은 예시(Android 8~11 포함):
   ```java
   // import android.os.Bundle; import android.widget.RemoteViews;
   if (awm.isRequestPinAppWidgetSupported()) {
       Bundle extras = new Bundle(); // 추가 창 미리보기 — 12+ 는 previewLayout 과 같은 예시
       extras.putParcelable(AppWidgetManager.EXTRA_APPWIDGET_PREVIEW, new RemoteViews(ctx.getPackageName(), R.layout.widget_today_preview));
       ok = awm.requestPinAppWidget(new ComponentName(ctx, TodayWidget.class), extras, null);
   }
   ```
4. (선택) Android 8~11 위젯 고르기(바탕화면 길게 누르기) 그림: 빌드 뒤 실제 미리보기를 캡처해 `res/drawable-nodpi/widget_today_preview.png` + `android:previewImage="@drawable/widget_today_preview"`.

예상 모습(브라우저로 그린 참고 그림 — 실제 안드로이드 화면 아님): `docs/screens/562-widget-preview-plan.png`

## 확인 방법(실기기)

- 앱 → [위젯 추가] → '홈 화면에 추가' 창 미리보기에 '오늘 할 일 · 지남 0 · 오늘 3 · 승인 1', 할 일 5줄(마지막 줄 ✓ 회색), '다음 일정 15:00 팀 회의'.
- 바탕화면 길게 누르기 → 위젯 → 워크인 → 같은 미리보기.
- 놓은 뒤에는 예시가 아니라 내 실제 할 일로 바뀌는지.

## `widget_today_preview.xml` 전체

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- 위젯 고르기·'홈 화면에 추가' 창의 미리보기(Android 12+ previewLayout · 8~11 은 requestPinWidget 의 EXTRA_APPWIDGET_PREVIEW).
     실제 위젯(widget_today)과 같은 모양에 예시 글자만 넣음 — 실제 내용은 추가한 뒤 서버에서 불러와 그림. 회사·사람 이름은 넣지 않음 -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg"
    android:orientation="vertical"
    android:padding="12dp">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal">

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:orientation="vertical">

            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="오늘 할 일"
                android:textColor="#0F766E"
                android:textSize="14sp"
                android:textStyle="bold" />

            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="지남 0 · 오늘 3 · 승인 1"
                android:textColor="#475569"
                android:textSize="11sp" />
        </LinearLayout>

        <TextView
            android:layout_width="32dp"
            android:layout_height="32dp"
            android:gravity="center"
            android:text="↻"
            android:textColor="#64748B"
            android:textSize="16sp" />

        <TextView
            android:layout_width="32dp"
            android:layout_height="32dp"
            android:layout_marginStart="4dp"
            android:background="@drawable/widget_add_bg"
            android:gravity="center"
            android:text="+"
            android:textColor="#FFFFFF"
            android:textSize="18sp"
            android:textStyle="bold" />
    </LinearLayout>

    <LinearLayout android:layout_width="match_parent" android:layout_height="30dp" android:layout_marginTop="6dp" android:gravity="center_vertical" android:orientation="horizontal">
        <TextView android:layout_width="28dp" android:layout_height="match_parent" android:gravity="center" android:text="○" android:textColor="#94A3B8" android:textSize="16sp" />
        <TextView android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:ellipsize="end" android:maxLines="1" android:text="주간 회의 자료 준비" android:textColor="#0F172A" android:textSize="13sp" />
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginStart="6dp" android:text="10:00" android:textColor="#64748B" android:textSize="11sp" />
    </LinearLayout>

    <LinearLayout android:layout_width="match_parent" android:layout_height="30dp" android:gravity="center_vertical" android:orientation="horizontal">
        <TextView android:layout_width="28dp" android:layout_height="match_parent" android:gravity="center" android:text="○" android:textColor="#94A3B8" android:textSize="16sp" />
        <TextView android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:ellipsize="end" android:maxLines="1" android:text="현장 점검 사진 올리기" android:textColor="#0F172A" android:textSize="13sp" />
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginStart="6dp" android:text="오늘" android:textColor="#64748B" android:textSize="11sp" />
    </LinearLayout>

    <LinearLayout android:layout_width="match_parent" android:layout_height="30dp" android:gravity="center_vertical" android:orientation="horizontal">
        <TextView android:layout_width="28dp" android:layout_height="match_parent" android:gravity="center" android:text="○" android:textColor="#94A3B8" android:textSize="16sp" />
        <TextView android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:ellipsize="end" android:maxLines="1" android:text="견적서 회신" android:textColor="#0F172A" android:textSize="13sp" />
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginStart="6dp" android:text="14:00" android:textColor="#64748B" android:textSize="11sp" />
    </LinearLayout>

    <LinearLayout android:layout_width="match_parent" android:layout_height="30dp" android:gravity="center_vertical" android:orientation="horizontal">
        <TextView android:layout_width="28dp" android:layout_height="match_parent" android:gravity="center" android:text="○" android:textColor="#94A3B8" android:textSize="16sp" />
        <TextView android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:ellipsize="end" android:maxLines="1" android:text="신규 직원 교육 일정 확인" android:textColor="#0F172A" android:textSize="13sp" />
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginStart="6dp" android:text="10/29" android:textColor="#64748B" android:textSize="11sp" />
    </LinearLayout>

    <LinearLayout android:layout_width="match_parent" android:layout_height="30dp" android:gravity="center_vertical" android:orientation="horizontal">
        <TextView android:layout_width="28dp" android:layout_height="match_parent" android:gravity="center" android:text="✓" android:textColor="#0F766E" android:textSize="16sp" />
        <TextView android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:ellipsize="end" android:maxLines="1" android:text="월간 보고서 제출" android:textColor="#94A3B8" android:textSize="13sp" />
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginStart="6dp" android:text="오늘" android:textColor="#64748B" android:textSize="11sp" />
    </LinearLayout>

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="6dp"
        android:ellipsize="end"
        android:maxLines="1"
        android:text="다음 일정 15:00 팀 회의"
        android:textColor="#475569"
        android:textSize="11sp" />
</LinearLayout>
```
