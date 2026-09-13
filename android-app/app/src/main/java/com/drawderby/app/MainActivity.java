package com.drawderby.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebResourceErrorCompat;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class MainActivity extends Activity {
    static final String OFFLINE_ORIGIN = "https://appassets.androidplatform.net";
    static final String OFFLINE_URL = OFFLINE_ORIGIN + "/assets/game/index.html";
    private static final int LIME = Color.rgb(213, 244, 68);
    private static final int INK = Color.rgb(39, 44, 33);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private SharedPreferences preferences;
    private FrameLayout content;
    private LinearLayout errorPanel;
    private TextView errorText;
    private ProgressBar progress;
    private Button soloButton, friendsButton;
    private String serverOrigin = "", currentUrl = OFFLINE_URL, pendingDraft;
    private boolean online, pageFailed, paused;
    private Runnable loadTimeout;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("draw-derby", MODE_PRIVATE);
        try {
            serverOrigin = ServerAddress.normalize(preferences.getString("server", ""));
        } catch (IllegalArgumentException ignored) { /* The first launch is fully offline. */ }
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        buildLayout();
        createWebView();
        loadPage(OFFLINE_URL, false);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private Button button(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(INK);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setMinimumWidth(0);
        button.setPadding(dp(10), dp(6), dp(10), dp(6));
        button.setOnClickListener(v -> action.run());
        return button;
    }

    private GradientDrawable background(int color) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(10));
        return shape;
    }

    private void buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(LIME);
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));

        LinearLayout bar = new LinearLayout(this);
        bar.setPadding(dp(8), dp(5), dp(8), dp(5));
        soloButton = button("혼자 연습", () -> {
            if (online) switchPage(OFFLINE_URL, false);
        });
        friendsButton = button("친구와 경주", () -> {
            if (!online) {
                if (serverOrigin.isEmpty()) showConnectionDialog();
                else switchPage(serverOrigin + "/?mode=friends", true);
            }
        });
        Button settingsButton = button("연결 설정", this::showConnectionDialog);
        for (Button item : new Button[]{soloButton, friendsButton, settingsButton}) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1);
            params.setMargins(dp(3), 0, dp(3), 0);
            item.setBackground(background(0x55ffffff));
            bar.addView(item, params);
        }
        root.addView(bar);

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorPanel.setBackgroundColor(LIME);
        TextView title = new TextView(this);
        title.setText("잠깐, 다시 출발할까요?");
        title.setTextColor(INK);
        title.setTextSize(24);
        title.setTypeface(null, Typeface.BOLD);
        errorPanel.addView(title);
        errorText = new TextView(this);
        errorText.setTextSize(15);
        errorText.setTextColor(INK);
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(20), 0, dp(24));
        errorPanel.addView(errorText);
        errorPanel.addView(button("다시 연결", () -> loadPage(currentUrl, online)));
        errorPanel.addView(button("인터넷 없이 혼자 연습", () -> loadPage(OFFLINE_URL, false)));
        errorPanel.addView(button("게임 서버 주소 확인", this::showConnectionDialog));
        errorPanel.setVisibility(View.GONE);
        content.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return insets;
            });
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int appearance = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(appearance, appearance);
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled") // The bundled React/canvas game needs JavaScript; no native JS bridge is exposed.
    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(LIME);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setTextZoom(100);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setWebViewClient(new GameClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value == 100 || pageFailed ? View.INVISIBLE : View.VISIBLE);
            }
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (BuildConfig.DEBUG && message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    android.util.Log.e("DrawDerby", message.message() + " (" + message.lineNumber() + ")");
                }
                return true;
            }
        });
        content.addView(webView, 0, new FrameLayout.LayoutParams(-1, -1));
    }

    private void loadPage(String url, boolean remote) {
        cancelTimeout();
        if (webView == null) createWebView();
        currentUrl = url;
        online = remote;
        pageFailed = false;
        errorPanel.setVisibility(View.GONE);
        soloButton.setBackground(background(remote ? 0x55ffffff : INK));
        soloButton.setTextColor(remote ? INK : LIME);
        friendsButton.setBackground(background(remote ? INK : 0x55ffffff));
        friendsButton.setTextColor(remote ? LIME : INK);
        progress.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
        if (remote) {
            loadTimeout = () -> {
                if (webView != null) webView.stopLoading();
                showError("서버 응답이 늦어지고 있어요. 같은 Wi-Fi인지, 게임 서버가 실행 중인지 확인해 주세요.");
            };
            handler.postDelayed(loadTimeout, 25000);
        }
    }

    private boolean isGameUrl(String url) {
        return ServerAddress.sameOrigin(url, OFFLINE_ORIGIN) || ServerAddress.sameOrigin(url, serverOrigin);
    }

    private void switchPage(String url, boolean remote) {
        if (webView == null || pageFailed || !isGameUrl(webView.getUrl())) {
            loadPage(url, remote);
            return;
        }
        webView.evaluateJavascript("(()=>{try{return JSON.stringify({draft:JSON.parse(localStorage.getItem('draw-derby-draft')||'null'),track:localStorage.getItem('draw-derby-track')})}catch{return null}})()", value -> {
            try {
                Object decoded = new JSONTokener(value).nextValue();
                if (decoded instanceof String && ((String) decoded).length() <= 1048576) {
                    pendingDraft = new JSONObject((String) decoded).toString();
                }
            } catch (JSONException ignored) { /* Each mode also keeps its own saved drawing. */ }
            if (!isFinishing() && !isDestroyed()) loadPage(url, remote);
        });
    }

    private void importPendingDraft(WebView view) {
        if (pendingDraft == null || !isGameUrl(view.getUrl())) return;
        String encoded = JSONObject.quote(pendingDraft);
        pendingDraft = null;
        view.evaluateJavascript("(()=>{const data=JSON.parse(" + encoded + ");let attempts=0;function restore(){if(document.documentElement.dataset.derbyReady==='true'){document.dispatchEvent(new CustomEvent('draw-derby-import',{detail:data}))}else if(++attempts<200){setTimeout(restore,50)}}restore()})()", null);
    }

    private void showConnectionDialog() {
        LinearLayout fields = new LinearLayout(this);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(24), dp(10), dp(24), 0);
        TextView note = new TextView(this);
        note.setText("친구들과 같은 게임 서버 주소를 입력하세요.\n연결한 뒤 방을 만들거나 6자리 방 코드로 참가할 수 있어요.");
        note.setTextColor(INK);
        note.setPadding(0, 0, 0, dp(16));
        fields.addView(note);
        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("https://게임서버주소");
        address.setText(serverOrigin);
        address.setContentDescription("게임 서버 주소");
        fields.addView(address);
        TextView hint = new TextView(this);
        hint.setText("같은 Wi-Fi의 PC에서 실행한다면\nhttp://PC의IP주소:3000\n\n에뮬레이터에서는 http://10.0.2.2:3000");
        hint.setTextSize(12);
        hint.setPadding(0, dp(12), 0, dp(4));
        fields.addView(hint);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("친구와 경주 · 서버 연결")
                .setView(fields).setNegativeButton("취소", null).setPositiveButton("연결하기", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                String selected = ServerAddress.normalize(address.getText().toString());
                // Capture the old origin's draft before trusting the newly selected origin.
                switchToServer(selected);
                dialog.dismiss();
            } catch (IllegalArgumentException e) { address.setError(e.getMessage()); }
        }));
        dialog.show();
    }

    private void switchToServer(String selected) {
        if (webView != null && !pageFailed && isGameUrl(webView.getUrl())) {
            webView.evaluateJavascript("(()=>{try{return JSON.stringify({draft:JSON.parse(localStorage.getItem('draw-derby-draft')||'null'),track:localStorage.getItem('draw-derby-track')})}catch{return null}})()", value -> {
                try {
                    Object decoded = new JSONTokener(value).nextValue();
                    if (decoded instanceof String && ((String) decoded).length() <= 1048576) pendingDraft = new JSONObject((String) decoded).toString();
                } catch (JSONException ignored) { }
                selectServer(selected);
            });
        } else selectServer(selected);
    }

    private void selectServer(String selected) {
        if (isFinishing() || isDestroyed()) return;
        serverOrigin = selected;
        preferences.edit().putString("server", selected).apply();
        loadPage(selected + "/?mode=friends", true);
    }

    private void cancelTimeout() {
        if (loadTimeout != null) handler.removeCallbacks(loadTimeout);
        loadTimeout = null;
    }

    private void showError(String message) {
        cancelTimeout();
        pageFailed = true;
        progress.setVisibility(View.INVISIBLE);
        errorText.setText(message);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(),
                new ByteArrayInputStream("Unavailable".getBytes(StandardCharsets.UTF_8)));
    }

    private final class GameClient extends WebViewClientCompat {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (ServerAddress.sameOrigin(uri.toString(), OFFLINE_ORIGIN)) {
                WebResourceResponse response = assetLoader.shouldInterceptRequest(uri);
                return response != null ? response : blocked();
            }
            // No unencrypted public subresources, including redirects from a LAN server.
            if ("http".equals(uri.getScheme()) && !ServerAddress.sameOrigin(uri.toString(), serverOrigin)) return blocked();
            return null;
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (url.equals("drawderby://connect") && ServerAddress.sameOrigin(view.getUrl(), OFFLINE_ORIGIN)) {
                showConnectionDialog();
                return true;
            }
            if (isGameUrl(url)) return false;
            if (request.isForMainFrame() && request.hasGesture()
                    && ("https".equals(request.getUrl().getScheme()) || "http".equals(request.getUrl().getScheme()))) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                catch (ActivityNotFoundException ignored) { Toast.makeText(MainActivity.this, "링크를 열 브라우저가 없어요.", Toast.LENGTH_SHORT).show(); }
            }
            return true;
        }

        @Override public void onPageFinished(WebView view, String url) {
            if (pageFailed || !isGameUrl(url)) return;
            cancelTimeout();
            importPendingDraft(view);
            view.evaluateJavascript("document.dispatchEvent(new CustomEvent('draw-derby-visibility',{detail:{visible:" + !paused + "}}))", null);
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceErrorCompat error) {
            if (request.isForMainFrame()) showError(online
                    ? "게임 서버에 연결하지 못했어요. 서버 주소와 Wi-Fi 연결을 확인해 주세요. 혼자 연습은 인터넷 없이도 할 수 있어요."
                    : "게임을 불러오지 못했어요. 다시 실행하거나 Android System WebView를 업데이트해 주세요.");
        }

        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame()) showError("게임 서버가 응답하지 않아요. 서버 주소를 확인하거나 잠시 후 다시 연결해 주세요.");
        }

        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            content.removeView(view);
            view.destroy();
            webView = null;
            showError("게임 화면이 잠시 멈췄어요. 다시 연결하면 저장한 동물로 계속할 수 있어요.");
            return true;
        }
    }

    @Override protected void onPause() {
        paused = true;
        if (webView != null) {
            webView.evaluateJavascript("document.dispatchEvent(new CustomEvent('draw-derby-visibility',{detail:{visible:false}}))", null);
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        paused = false;
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            webView.evaluateJavascript("document.dispatchEvent(new CustomEvent('draw-derby-visibility',{detail:{visible:true}}))", null);
        }
    }

    // Android 8–12 fallback. Android 13+ uses the OnBackInvoked callback in onCreate.
    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (online) switchPage(OFFLINE_URL, false);
        else finish();
    }

    @Override protected void onDestroy() {
        cancelTimeout();
        if (webView != null) {
            content.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
