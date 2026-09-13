package com.drawderby.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class ServerAddressTest {
    @Test public void acceptsProductionAndLocalMultiplayerServers() {
        assertEquals("https://game.example.com", ServerAddress.normalize(" HTTPS://GAME.EXAMPLE.COM:443/ "));
        assertEquals("http://192.168.0.12:3000", ServerAddress.normalize("http://192.168.0.12:3000/"));
        assertEquals("http://10.0.2.2:3000", ServerAddress.normalize("http://10.0.2.2:3000"));
        assertEquals("http://localhost:3000", ServerAddress.normalize("http://localhost:3000"));
        assertEquals("http://[::1]:3000", ServerAddress.normalize("http://[::1]:3000"));
        assertEquals("http://172.31.0.4:3000", ServerAddress.normalize("http://172.31.0.4:3000"));
    }

    @Test public void rejectsUnusableOrUntrustedAddresses() {
        for (String value : new String[]{"", "game.example.com", "javascript:alert(1)", "file:///sdcard/game.html",
                "https://user:password@game.example.com", "https://game.example.com/path", "https://game.example.com/?room=ABC123",
                "https://game.example.com/#fragment", "http://game.example.com", "http://172.32.0.1",
                "http://192.168.999.1", "http://10.0.2.2.evil.example", "https://appassets.androidplatform.net",
                "https://game.example.com:0", "https://game.example.com:65536"}) {
            assertThrows(value, IllegalArgumentException.class, () -> ServerAddress.normalize(value));
        }
    }

    @Test public void navigationRequiresExactOriginIncludingPort() {
        String origin = "https://game.example.com";
        assertTrue(ServerAddress.sameOrigin("https://game.example.com/?room=ABC123", origin));
        assertTrue(ServerAddress.sameOrigin("https://game.example.com:443/", origin));
        assertFalse(ServerAddress.sameOrigin("https://game.example.com.evil.example/", origin));
        assertFalse(ServerAddress.sameOrigin("https://game.example.com:444/", origin));
        assertFalse(ServerAddress.sameOrigin("http://game.example.com/", origin));
        assertFalse(ServerAddress.sameOrigin("https://game.example.com@evil.example/", origin));
        assertFalse(ServerAddress.sameOrigin("file:///assets/game/index.html", origin));
    }
}
