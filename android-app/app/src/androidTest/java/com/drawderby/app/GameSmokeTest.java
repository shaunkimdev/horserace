package com.drawderby.app;

import android.app.Instrumentation;
import android.content.Intent;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONTokener;
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
        instrumentation.getTargetContext().getSharedPreferences("draw-derby", Context.MODE_PRIVATE)
                .edit().remove("server").remove("published-server-configured").commit();
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = (MainActivity) instrumentation.startActivitySync(intent);
        instrumentation.runOnMainSync(() -> view = findWebView(activity.findViewById(android.R.id.content)));
        assertNotNull("The APK must create its game WebView", view);
        await("document.documentElement.dataset.derbyReady === 'true'", 20000);
        assertEquals(ServerAddress.DEFAULT_ORIGIN, activity.getSharedPreferences("draw-derby", Context.MODE_PRIVATE).getString("server", ""));
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
        assertFalse("Rotation must preserve the game Activity and its WebSocket", activity.isDestroyed());
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> view.evaluateJavascript(code, value -> { result.set(value); latch.countDown(); }));
        assertTrue("Game JavaScript did not respond", latch.await(8, TimeUnit.SECONDS));
        return result.get();
    }

    private void await(String condition, long milliseconds) throws Exception {
        long until = SystemClock.uptimeMillis() + milliseconds;
        while (SystemClock.uptimeMillis() < until) {
            if ("true".equals(js("(()=>{try{return Boolean(" + condition + ")}catch{return false}})()"))) return;
            SystemClock.sleep(150);
        }
        fail("Timed out: " + condition);
    }

    private void connect(String server) throws Exception {
        if (ServerAddress.DEFAULT_ORIGIN.equals(server)) {
            Method open = MainActivity.class.getDeclaredMethod("openMultiplayer");
            open.setAccessible(true);
            instrumentation.runOnMainSync(() -> {
                try { open.invoke(activity); } catch (Exception e) { throw new RuntimeException(e); }
            });
            return;
        }
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
        assertEquals(MainActivity.OFFLINE_URL, new JSONTokener(js("location.href")).nextValue());
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
            await("innerWidth > innerHeight", 10000);
            assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, activity.getRequestedOrientation());
            await("(()=>{const c=document.querySelector('.race-canvas-wrap canvas');const r=c.getBoundingClientRect();return c.width>=1200&&c.height===620&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&c.getContext('2d').getImageData(260,339,1,1).data[3]>0})()", 5000);
            // Advance the solo clock, checking that each complete simulated race reaches results.
            js("(()=>{const clock=Date.now;Date.now=()=>clock()+120000})()");
            await("document.querySelector('.stage-results')", 5000);
            await("innerWidth < innerHeight", 10000);
            assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, activity.getRequestedOrientation());
            assertEquals("4", js("document.querySelectorAll('.result-row').length"));
            reload();
        }
        assertEquals("안드로이드 달리미", new JSONTokener(js("document.querySelector('.name-field input').value")).nextValue());
    }

    @Test public void failedConnectionCanReturnToOfflinePractice() throws Exception {
        connect("http://127.0.0.1:1");
        SystemClock.sleep(2500);
        assertTrue(instrumentation.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK));
        await("location.origin === 'https://appassets.androidplatform.net' && document.documentElement.dataset.derbyReady === 'true'", 15000);
        assertEquals("true", js("!!document.querySelector('.stage-draw .start-button')"));
    }

    @Test public void androidHostSharesDrawingTrackAndRaceWithSevenOnlinePlayers() throws Exception {
        String server = InstrumentationRegistry.getArguments().getString("serverUrl", "");
        assumeTrue("Pass -e serverUrl to test real multiplayer", !server.isEmpty());
        js("document.querySelectorAll('.track-card')[1].click()");
        await("localStorage.getItem('draw-derby-track') === 'oval'", 5000);
        String draft = savedDrawing();
        connect(ServerAddress.normalize(server));
        await("location.origin !== 'https://appassets.androidplatform.net' && document.documentElement.dataset.derbyReady === 'true'", 25000);
        await("localStorage.getItem('draw-derby-track') === 'oval'", 5000);
        assertEquals(draft, savedDrawing());
        await("document.querySelector('.capacity-stepper output')", 5000);
        assertEquals("4명", new JSONTokener(js("document.querySelector('.capacity-stepper output').textContent")).nextValue());
        // Exercise both bounds using the same +/- controls the player sees.
        for (int i = 0; i < 2; i++) { js("document.querySelector('.capacity-stepper button:first-child').click()"); SystemClock.sleep(100); }
        assertEquals("true", js("document.querySelector('.capacity-stepper button:first-child').disabled"));
        for (int i = 0; i < 6; i++) { js("document.querySelector('.capacity-stepper button:last-child').click()"); SystemClock.sleep(100); }
        assertEquals("true", js("document.querySelector('.capacity-stepper button:last-child').disabled"));
        js("document.querySelector('.start-button').click()");
        await("document.querySelector('.stage-lobby')", 10000);
        assertEquals("8", js("document.querySelectorAll('.player-card').length"));
        js("""
                (async()=>{try{
                  const host=JSON.parse(sessionStorage.getItem('draw-derby-room'));
                  const animal=JSON.parse(localStorage.getItem('draw-derby-draft'));
                  window.testMembers=[host]; window.testSockets=[];
                  for(let i=1;i<=7;i++){
                    const response=await fetch('/api/rooms/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:host.code,name:'접속 선수 '+i,animal:{...animal,name:'접속 선수 '+i}})});
                    if(!response.ok)throw new Error('join '+response.status);
                    const guest=await response.json();
                    window.testMembers.push({code:host.code,token:guest.token});
                    await new Promise((resolve,reject)=>{
                      const url=new URL('/api/rooms/'+host.code+'/socket',location.origin);
                      url.protocol=location.protocol==='https:'?'wss:':'ws:';
                      const socket=new WebSocket(url,['draw-derby.v1','token.'+guest.token]);
                      window.testSockets.push(socket);
                      const timer=setTimeout(()=>reject(new Error('socket timeout')),10000);
                      socket.onmessage=event=>{if(JSON.parse(event.data).type==='state'){clearTimeout(timer);resolve()}};
                      socket.onerror=()=>{clearTimeout(timer);reject(new Error('socket failed'))};
                    });
                  }
                  for(const member of window.testMembers){
                    const ready=await fetch('/api/rooms/'+host.code,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+member.token},body:JSON.stringify({action:'ready',ready:true})});
                    if(!ready.ok)throw new Error('ready '+ready.status);
                  }
                  const started=await fetch('/api/rooms/'+host.code,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+host.token},body:JSON.stringify({action:'start'})});
                  const result=await started.json();
                  window.testRaceOK=started.ok&&result.room.capacity===8&&result.room.race.players.length===8&&result.room.race.trackId==='oval';
                }catch(error){window.testRaceError=String(error)}})()
                """);
        await("window.testRaceOK || window.testRaceError", 40000);
        assertEquals(js("window.testRaceError || ''"), "true", js("window.testRaceOK === true"));
        await("document.querySelector('.stage-race canvas')", 10000);
        await("innerWidth > innerHeight", 10000);
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, activity.getRequestedOrientation());
        assertEquals("8", js("document.querySelectorAll('.live-standings > div').length"));
    }

    @After public void close() throws Exception {
        if (activity == null) return;
        if (view != null) {
            js("(async()=>{for(const member of window.testMembers||[]){await fetch('/api/rooms/'+member.code,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+member.token},body:JSON.stringify({action:'leave'})})}for(const socket of window.testSockets||[])socket.close();sessionStorage.removeItem('draw-derby-room');window.testCleanupDone=true})().catch(()=>{window.testCleanupDone=true})");
            await("window.testCleanupDone", 8000);
        }
        instrumentation.runOnMainSync(activity::finish);
    }
}
