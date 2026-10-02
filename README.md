# Tebak Cepat (host web + server WebSocket)

```
server/  → Node.js + ws (room, soal, skor, timer). Deploy ke Render/Railway/Fly (BUKAN Vercel)
web/     → halaman host (QR + layar kuis). Static, bisa di Vercel
```

Vercel tidak mendukung server WebSocket yang terus hidup, jadi server harus di platform lain.

## Jalankan lokal
```
cd server && npm install && npm start
```
Buka http://localhost:3000 (server ikut menyajikan folder `web/`).
Dari emulator Android, server laptop = `ws://10.0.2.2:3000`. Untuk HP asli pakai IP laptop,
dan buka host lewat `http://IP-LAPTOP:3000` supaya isi QR berupa IP, bukan localhost.

## Deploy
1. Push repo ini ke GitHub.
2. **Server → Render** (New → Web Service): Root Directory `server`, Build `npm install`, Start `npm start`.
   Hasilnya URL seperti `https://gamekuis.onrender.com`. Cek `/health`.
3. **Web → Vercel**: Import repo, Root Directory `web`, Framework "Other".
   Sebelum itu isi `web/config.js`: `window.GAMEKUIS_SERVER = "wss://gamekuis.onrender.com";`
   (Alternatif tanpa Vercel: buka saja URL Render, server sudah menyajikan halaman host.)

## Isi QR
`wss://SERVER/ws?room=AB3K` — APK tinggal parse `room` dan connect ke bagian sebelum `?`.

## Protokol JSON
APK → server
- `{"type":"join","room":"AB3K","name":"Cupank"}`
- `{"type":"answer","value":"red|blue|yellow|green"}`

Server → APK
- `{"type":"joined","id","name","state"}` · `{"type":"error","message"}`
- `{"type":"question","index","total","seconds"}` → aktifkan 4 tombol
- `{"type":"answered"}` → kunci tombol
- `{"type":"reveal","correct","answer","isCorrect","score"}`
- `{"type":"final","ranking":[{"name","score"}]}` · `{"type":"room_closed"}`

Mapping tombol: ▲ red, ◆ blue, ● yellow, ■ green.

## Contoh Kotlin (OkHttp)
```kotlin
val uri = Uri.parse(qrText)                       // wss://host/ws?room=AB3K
val room = uri.getQueryParameter("room")
val url = qrText.substringBefore("?")
val ws = OkHttpClient().newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
    override fun onOpen(w: WebSocket, r: Response) {
        w.send("""{"type":"join","room":"$room","name":"$name"}""")
    }
    override fun onMessage(w: WebSocket, text: String) {
        val j = JSONObject(text)
        when (j.getString("type")) {
            "question" -> runOnUiThread { enableButtons() }
            "reveal"   -> runOnUiThread { showResult(j.getBoolean("isCorrect")) }
            "final"    -> runOnUiThread { showRanking(j.getJSONArray("ranking")) }
        }
    }
})
// jawab: ws.send("""{"type":"answer","value":"red"}""")
```
Untuk `ws://` (tanpa HTTPS) di Android, aktifkan `android:usesCleartextTraffic="true"` di manifest saat tes lokal.
