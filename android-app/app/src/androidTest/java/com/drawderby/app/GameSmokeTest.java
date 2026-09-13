package com.drawderby.app;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/** Exercises the actual installed APK, its embedded game, and the native mode switch. */
@RunWith(AndroidJUnit4.class)
public class GameSmokeTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;
    private WebView view;

    @Before public void launch() throws Exception {
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = (MainActivity) instrumentation.startActivitySync(intent);
        instrumentation.runOnMainSync(() -> view = findWebView(activity.findViewById(android.R.id.content)));
        assertNotNull("The APK must create its game WebView", view);
        await("document.documentElement.dataset.derbyReady === 'true'", 20000);
    }

    private WebView findWebView(View parent) {
        if (parent instanceof WebView) return (WebView) parent;
        if (parent instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) parent;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private String js(String code) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> view.evaluateJavascript(code, value -> { result.set(value); latch.countDown(); }));
        assertTrue("Game JavaScript did not respond", latch.await(8, TimeUnit.SECONDS));
        return result.get();
    }

    private void await(String condition, long milliseconds) throws Exception {
        long until = SystemClock.uptimeMillis() + milliseconds;
        while (SystemClock.uptimeMillis() < until) {
            if ("true".equals(js("Boolean(" + condition + ")"))) return;
            SystemClock.sleep(150);
        }
        fail("Timed out: " + condition);
    }

    private void connect(String server) throws Exception {
        Method method = MainActivity.class.getDeclaredMethod("switchToServer", String.class);
        method.setAccessible(true);
        instrumentation.runOnMainSync(() -> {
            try { method.invoke(activity, server); } catch (Exception e) { throw new RuntimeException(e); }
        });
    }

    private void reload() throws Exception {
        js("window.testReloadMark = true");
        instrumentation.runOnMainSync(() -> view.reload());
        await("!window.testReloadMark && document.documentElement.dataset.derbyReady === 'true'", 15000);
    }

    private String savedDrawing() throws Exception {
        return js("(()=>{const d=JSON.parse(localStorage.getItem('draw-derby-draft'));return JSON.stringify([d.name,d.strokes.map(s=>[s.color,s.points.map(p=>[p.x,p.y])])])})()");
    }

    @Test public void offlineGameRacesOnAllFourTracksAndKeepsTheAnimal() throws Exception {
        assertEquals(JSONObject.quote(MainActivity.OFFLINE_URL), js("location.href"));
        instrumentation.runOnMainSync(() -> view.getSettings().setBlockNetworkLoads(true));
        reload();
        assertEquals("4", js("document.querySelectorAll('.track-card').length"));
        js("(()=>{const input=document.querySelector('.name-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'안드로이드 달리미');input.dispatchEvent(new Event('input',{bubbles:true}))})()");
        await("JSON.parse(localStorage.getItem('draw-derby-draft')).name === '안드로이드 달리미'", 5000);
        for (int track = 0; track < 4; track++) {
            js("document.querySelectorAll('.track-card')[" + track + "].click()");
            SystemClock.sleep(200);
            js("document.querySelector('.start-button').click()");
            await("document.querySelector('.stage-race canvas')", 10000);
            await("(()=>{const c=document.querySelector('.race-canvas-wrap canvas');return c.width===1200&&c.height===620&&c.getContext('2d').getImageData(260,339,1,1).data[3]>0})()", 5000);
            // Advance the solo clock, checking that each complete simulated race reaches results.
            js("(()=>{const clock=Date.now;Date.now=()=>clock()+120000})()");
            await("document.querySelector('.stage-results')", 5000);
            assertEquals("4", js("document.querySelectorAll('.result-row').length"));
            reload();
        }
        assertEquals(JSONObject.quote("안드로이드 달리미"), js("document.querySelector('.name-field input').value"));
    }

    @Test public void failedConnectionCanReturnToOfflinePractice() throws Exception {
        connect("http://127.0.0.1:1");
        SystemClock.sleep(2500);
        assertTrue(instrumentation.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK));
        await("location.origin === 'https://appassets.androidplatform.net' && document.documentElement.dataset.derbyReady === 'true'", 15000);
        assertEquals("true", js("!!document.querySelector('.stage-draw .start-button')"));
    }

    @Test public void androidHostSharesDrawingTrackAndRaceWithThreeOnlinePlayers() throws Exception {
        String server = InstrumentationRegistry.getArguments().getString("serverUrl", "");
        assumeTrue("Pass -e serverUrl to test real multiplayer", !server.isEmpty());
        js("document.querySelectorAll('.track-card')[1].click()");
        await("localStorage.getItem('draw-derby-track') === 'oval'", 5000);
        String draft = savedDrawing();
        connect(ServerAddress.normalize(server));
        await("location.origin !== 'https://appassets.androidplatform.net' && document.documentElement.dataset.derbyReady === 'true'", 25000);
        await("localStorage.getItem('draw-derby-track') === 'oval'", 5000);
        assertEquals(draft, savedDrawing());
        js("document.querySelector('.start-button').click()");
        await("document.querySelector('.stage-lobby')", 10000);
        js("(async()=>{try{const host=JSON.parse(sessionStorage.getItem('draw-derby-room'));const animal=JSON.parse(localStorage.getItem('draw-derby-draft'));window.testMembers=[host];for(let i=1;i<=3;i++){const response=await fetch('/api/rooms/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:host.code,name:'접속 선수 '+i,animal:{...animal,name:'접속 선수 '+i}})});if(!response.ok)throw new Error('join '+response.status);const guest=await response.json();window.testMembers.push({code:host.code,token:guest.token})}for(const member of window.testMembers){const ready=await fetch('/api/rooms/'+host.code,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+member.token},body:JSON.stringify({action:'ready',ready:true})});if(!ready.ok)throw new Error('ready '+ready.status)}const started=await fetch('/api/rooms/'+host.code,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+host.token},body:JSON.stringify({action:'start'})});const result=await started.json();window.testRaceOK=started.ok&&result.room.race.players.length===4&&result.room.race.trackId==='oval'}catch(error){window.testRaceError=String(error)}})()");
        await("window.testRaceOK || window.testRaceError", 20000);
        assertEquals("true", js("window.testRaceOK === true"));
        await("document.querySelector('.stage-race canvas')", 10000);
        assertEquals("4", js("document.querySelectorAll('.standing-row').length || document.querySelectorAll('.live-standings > div').length"));
    }

    @After public void close() throws Exception {
        if (activity == null) return;
        if (view != null) {
            js("(async()=>{for(const member of window.testMembers||[]){await fetch('/api/rooms/'+member.code,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+member.token},body:JSON.stringify({action:'leave'})})}sessionStorage.removeItem('draw-derby-room');window.testCleanupDone=true})().catch(()=>{window.testCleanupDone=true})");
            await("window.testCleanupDone", 8000);
        }
        instrumentation.runOnMainSync(activity::finish);
    }
}
