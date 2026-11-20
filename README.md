# 現實躲貓貓

在校園裡玩的現實躲貓貓網頁 App：抽鬼、躲好、做任務，不然位置會曝光給鬼。規則見 [spec.md](spec.md)。

## 第一次設定（約 10 分鐘）

1. 到 [Firebase 主控台](https://console.firebase.google.com/) 建立專案（免費的 Spark 方案即可，不用綁卡）。
2. **Authentication** → 登入方式 → 啟用「匿名」。
3. **Firestore Database** → 建立資料庫（正式版模式，區域選 `asia-east1` 台灣）。
4. 專案設定 → 一般 → 新增「網頁應用程式」，把 SDK 設定填進 `.env.local`：
   ```sh
   cp .env.example .env.local
   ```
5. 安裝並部署安全規則：
   ```sh
   npm install
   npx firebase-tools login
   npx firebase-tools use --add        # 選剛剛建立的專案
   npx firebase-tools deploy --only firestore:rules
   ```

## 開發

```sh
npm run dev      # 本機開發
npm test         # 規則邏輯的單元測試
```

手機定位需要 HTTPS。要在手機上測試，最簡單的方式是直接部署（見下方），或執行 `npm run dev -- --host` 後用 ngrok 等工具轉成 HTTPS 網址。

## 部署（朋友用這個網址玩）

```sh
npm run build
npx firebase-tools deploy --only hosting
```

部署完會得到 `https://<專案>.web.app`，傳給朋友即可。iOS 和 Android 都直接用瀏覽器開啟。

## 遊玩提醒

- 加入時要允許定位；遊戲期間頁面要一直開著（螢幕會保持常亮），建議帶行動電源。
- 建議戴一邊耳機，才聽得到任務提示音。
- **房主的手機就是主持人**：房主關掉頁面，遊戲會暫停，回來後計時自動順延。

## 架構

| 位置 | 內容 |
|---|---|
| `src/lib/rules.ts` | 遊戲規則：洩漏等級、計分、任務產生（純函式，有單元測試） |
| `src/host/useHostLoop.ts` | 房主瀏覽器的主持迴圈：階段切換、派任務、判定逾時／離線／出界 |
| `src/lib/room.ts` | Firestore 讀寫：建房、加入、抽鬼、完成任務、回報被抓 |
| `src/hooks/` | 即時訂閱、GPS、心跳、螢幕常亮 |
| `src/screens/` | 首頁、大廳、遊戲、結算畫面 |
| `src/tasks/` | 6 種任務 |
| `firestore.rules` | 安全規則：躲藏者的位置只有本人與房主讀得到 |
