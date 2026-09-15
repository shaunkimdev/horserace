# 드로우 더비 · Android

직접 그린 동물로 달리는 안드로이드 앱입니다. 기존 `../game`의 그리기, 동물 형태 분석, 네 가지 트랙, 달리기 애니메이션, 음악을 함께 사용합니다. Android 전용 소스, 설정, 빌드 스크립트와 설치 파일은 이 폴더에 보관합니다.

## 설치와 플레이

1. `releases/DrawDerby-debug.apk`를 안드로이드 기기에 복사하고 설치합니다. 직접 설치할 때 기기의 안내에 따라 해당 파일 앱의 설치를 허용합니다.
2. **혼자 연습**에서는 인터넷 연결 없이 동물을 그리고 AI 3명과 달릴 수 있습니다. 동물과 선택한 트랙은 기기에 저장됩니다.
3. **친구와 경주**를 누르면 기본 서버 `https://draw-derby.musicapp.workers.dev`에 바로 연결합니다. 방 정원은 기본 4명이며 방장이 `− / +`로 2~8명으로 조절합니다. 같은 서버의 웹·안드로이드 플레이어가 방 코드로 함께 달립니다. **연결 설정**에서 주소를 변경하거나 **기본 서버** 버튼으로 되돌릴 수 있습니다.
4. 경주가 시작되면 가로 전체 화면으로 자동 전환하고 하단 메뉴를 숨겨 트랙을 넓게 보여줍니다. 결과 화면이나 연습 화면으로 돌아오면 이전 화면 방향과 메뉴가 복구됩니다. 오프라인·온라인 경주 모두 적용됩니다.

Android 8.0(API 26) 이상을 지원합니다. Canvas와 Web Audio를 사용하므로 Android System WebView/Chrome은 최신 버전으로 업데이트해 주세요. 이 APK는 직접 설치·테스트용 디버그 서명입니다. Google Play 배포용 서명 키는 포함하지 않습니다.

## 같은 Wi-Fi에서 멀티플레이

PC와 안드로이드 기기를 같은 Wi-Fi에 연결하고, PC에서 게임 서버를 실행합니다.

```powershell
cd ..\game
npm.cmd ci
npm.cmd run dev -- --hostname 0.0.0.0 --port 3000
```

앱의 **연결 설정**에 `http://PC의IPv4주소:3000`을 입력합니다. 예를 들어 PC의 IPv4 주소가 `192.168.0.12`라면 `http://192.168.0.12:3000`입니다. 주소는 PC의 `ipconfig`에서 확인할 수 있습니다. 친구의 웹 브라우저도 같은 주소로 접속하면 됩니다. PC 방화벽이 연결을 막는 경우 개인 네트워크에서 해당 서버 연결을 허용해야 합니다.

안드로이드 에뮬레이터에서 PC의 서버에 접속할 때는 `http://10.0.2.2:3000`을 사용합니다. 휴대폰에서 `localhost`는 휴대폰 자신을 가리키므로 PC 서버 주소로 사용하지 않습니다.

기본 서버는 이미 HTTPS로 배포되어 있어 Wi-Fi나 모바일 데이터로 서로 다른 장소에서도 플레이할 수 있습니다. 서버 주소는 `https://draw-derby.musicapp.workers.dev`입니다. 1.1.0 이후 버전을 처음 설치하거나 이전 APK에서 업데이트하면 이 주소가 한 번 자동 설정됩니다. 이후 직접 변경한 주소는 유지합니다. 서버 경로는 기본 주소(`/`)를 사용하고, 입력한 주소는 기기에만 저장합니다.

온라인 멀티플레이는 서버에서 웹 화면을 불러오므로 새 Workers + Durable Objects + WebSocket 서버 주소를 입력하면 사용합니다. 참가자 회원가입은 필요하지 않습니다. 연결 설정에는 `wss://`가 아닌 게임의 `https://` 기본 주소를 입력하세요. WebSocket 접속과 재연결은 게임이 자동으로 처리합니다. [Cloudflare 로그인·배포 안내](../game/README.md#cloudflare에-배포)를 참고하세요.

## APK 빌드

필요한 도구는 Node.js 22.13 이상, JDK 21, Android SDK Platform 37, Build Tools 36.0.0 이상입니다. Gradle 9.5.0과 Android Gradle Plugin 9.3.0을 고정해 사용합니다. Android Studio에서 이 폴더를 열 수도 있습니다.

`../game`에서 한 번 `npm.cmd ci`를 실행한 뒤:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

JDK 또는 SDK가 자동으로 발견되지 않는 경우 경로를 지정합니다.

```powershell
.\build.ps1 -JavaHome "C:\경로\jdk-21" -SdkRoot "C:\경로\Android\Sdk"
```

첫 빌드는 공개 의존성을 내려받으므로 인터넷이 필요합니다. 이후 모든 의존성이 캐시에 있다면 `-Offline`을 사용할 수 있습니다. 스크립트는 웹 게임을 내장 에셋으로 빌드하고, APK 생성·Java 단위 검사·Android Lint를 실행한 후 `releases/DrawDerby-debug.apk`에 복사합니다. 앱 런타임의 오프라인 플레이는 빌드 시 인터넷 연결 여부와 무관합니다.

PowerShell 스크립트는 Gradle 캐시와 안드로이드 임시 파일도 이 폴더 아래에 저장합니다. `local.properties`는 각 PC의 SDK 위치를 기록하는 자동 생성 파일입니다. 기존 SDK와 JDK 자체를 프로젝트에 복사하지는 않습니다.

macOS/Linux에서는 JDK/SDK 환경 변수를 설정한 뒤 `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`로 빌드할 수 있습니다. `node`가 PATH에 있어야 하고, 웹 소스는 동일하게 옆의 `game` 폴더에 있어야 합니다.

## 검사

```powershell
node scripts\build-web.mjs
node scripts\verify-bundle.mjs
.\build.ps1 -IncludeDeviceTests
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb install -r app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk
adb shell am instrument -w -e serverUrl http://10.0.2.2:3000 com.drawderby.app.test/androidx.test.runner.AndroidJUnitRunner
```

여러 기기가 연결되어 있으면 각 `adb` 명령에 `-s 기기ID`를 추가합니다. 설치 대상은 테스트용 기기 또는 에뮬레이터를 선택합니다. 기기 검사는 실제 APK에서 네 트랙의 오프라인 경주·이름 저장·가로 전환과 복구·서버 연결 실패 복구·그림과 트랙 전달·정원 버튼의 2~8명 범위·8인 방 시작을 확인합니다. `serverUrl`을 생략하면 온라인 검사만 건너뜁니다. 검사 완료 여부와 환경은 `VERIFICATION.md`를 참고하세요.

## 파일 구성

| 경로 | 내용 |
| --- | --- |
| `app/src/main/java/` | 앱 화면, 안전한 에셋 로딩, 서버 연결, 앱 생명주기 처리 |
| `app/src/main/res/` | 앱 아이콘, 테마, 앱 이름 |
| `web/` | 기존 게임을 재사용하는 오프라인 진입점과 터치 스타일 |
| `scripts/build-web.mjs` | 웹 소스를 APK 에셋으로 빌드, 외부 폰트 요청 제거 |
| `app/src/test/` | 서버 주소 및 내비게이션 정책 검사 |
| `app/src/androidTest/` | 설치된 앱의 기능 검사 |
| `releases/` | 설치용 APK |

웹과 앱은 같은 경주 엔진을 사용합니다. 앱의 오프라인 화면은 [Android의 WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) 방식으로 HTTPS 로컬 에셋을 불러옵니다. 온라인 모드에서는 지정한 게임 서버 전체를 같은 출처로 열어 방 인증과 동기화를 사용합니다. 화면 방향 요청은 로컬 게임 또는 설정한 서버의 최상위 페이지에서만 받습니다. 일반 Java 객체를 JavaScript에 노출하지 않으며 SSL 오류를 우회하지 않습니다.
