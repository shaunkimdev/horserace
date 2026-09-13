package com.drawderby.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Only a user-selected game origin may be loaded in the online WebView. */
public final class ServerAddress {
    private ServerAddress() {}

    public static String normalize(String input) {
        try {
            URI uri = new URI(input.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if ((!scheme.equals("https") && !scheme.equals("http")) || host.isEmpty()
                    || uri.getRawUserInfo() != null || uri.getPort() == 0 || uri.getPort() > 65535
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))
                    || host.equals("appassets.androidplatform.net")) {
                throw new IllegalArgumentException("게임 서버의 기본 주소를 입력해 주세요. 예: https://game.example.com");
            }
            if (scheme.equals("http") && !isPrivateHost(host)) {
                throw new IllegalArgumentException("인터넷 서버는 https:// 주소를 사용해 주세요. http://는 같은 Wi-Fi의 로컬 서버에 사용할 수 있어요.");
            }
            int port = uri.getPort();
            if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
            return new URI(scheme, null, host, port, null, null, null).toASCIIString();
        } catch (URISyntaxException | NullPointerException e) {
            throw new IllegalArgumentException("올바른 게임 서버 주소를 입력해 주세요.");
        }
    }

    private static boolean isPrivateHost(String host) {
        if (host.equals("localhost") || host.equals("[::1]") || host.equals("::1")) return true;
        String[] octets = host.split("\\.");
        if (octets.length != 4) return false;
        int[] parts = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!octets[i].matches("0|[1-9][0-9]{0,2}")) return false;
            parts[i] = Integer.parseInt(octets[i]);
            if (parts[i] > 255) return false;
        }
        return parts[0] == 10 || parts[0] == 127
                || (parts[0] == 192 && parts[1] == 168)
                || (parts[0] == 172 && parts[1] >= 16 && parts[1] <= 31);
    }

    public static boolean sameOrigin(String url, String origin) {
        if (url == null || origin == null || origin.isEmpty()) return false;
        try {
            URI a = new URI(url), b = new URI(origin);
            return a.getRawUserInfo() == null && a.getScheme() != null && a.getHost() != null
                    && a.getScheme().equalsIgnoreCase(b.getScheme())
                    && a.getHost().equalsIgnoreCase(b.getHost()) && port(a) == port(b);
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private static int port(URI uri) {
        return uri.getPort() >= 0 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80);
    }
}
