# 드로우 더비 · DRAW DERBY

말이나 동물을 직접 그려 장애물 경주에 출전하는 게임입니다. 동물의 다리 길이·다리 간격·몸통 형태에 따라 점프, 충돌, 달리기 속도가 달라집니다. 웹과 안드로이드에서 최대 8명이 함께 플레이합니다.

| 폴더 | 내용 |
| --- | --- |
| [game](game/README.md) | 웹 게임, 2~8인 멀티플레이 서버, 공통 경주 엔진 |
| [android-app](android-app/README.md) | 오프라인 연습을 내장한 안드로이드 앱과 빌드 도구 |
| [설치용 APK](android-app/releases/DrawDerby-debug.apk) | 안드로이드 직접 설치·테스트용 APK |

직선 허들, 원형 경기장, 지그재그, S자 숲길의 네 트랙이 있습니다. 각 트랙의 장애물과 코너에 유리한 동물 형태가 다릅니다. 모든 트랙은 같은 근접 추적 시점으로 달리며, 원형 트랙의 코너는 더 완만하게 조정했습니다.

## 웹에서 실행

```powershell
cd game
npm.cmd ci
npm.cmd run dev -- --hostname 0.0.0.0 --port 3000
```

PC에서는 `http://localhost:3000`에 접속합니다. 같은 Wi-Fi의 기기는 `http://PC의IPv4주소:3000`에 접속할 수 있습니다.

공개 서버는 **https://draw-derby.musicapp.workers.dev/** 입니다. 안드로이드 앱의 **혼자 연습**은 인터넷 없이 실행됩니다. **친구와 경주**를 누르면 기본 서버에 바로 연결하며, 웹 플레이어와 같은 방에 참가할 수 있습니다. 경주 중에는 앱이 가로 전체 화면으로 전환되고 결과 화면에서 이전 화면 방향으로 돌아갑니다.

## 검사와 빌드

멀티플레이는 **Workers + SQLite 기반 Durable Objects + WebSocket**을 사용합니다. 방 정원은 기본 4명이며 방장이 `− / +` 버튼으로 2~8명으로 설정합니다. 여러 방을 동시에 운영할 수 있고, 게임 참가는 로그인 없이 가능합니다. [로그인·배포 안내](game/README.md#cloudflare에-배포)와 [GitHub 자동 배포 설정](game/README.md#github-자동-배포)을 참고하세요.

웹의 `npm.cmd test`, `npm.cmd run test:server`, `npm.cmd run lint`, `npm.cmd run build`로 경주·방 동기화와 웹 빌드를 확인합니다. 안드로이드는 `android-app/build.ps1`로 앱 빌드, Java 검사, Android Lint를 실행합니다. 자세한 도구 설정과 기기 검사는 각 폴더의 README에 있습니다.
