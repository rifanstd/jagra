# Jagra

[English](README.md)

Jagra adalah aplikasi desktop untuk Windows dan macOS yang menguji build Android sebelum diserahkan ke QA. Arahkan ke aplikasi Anda lalu tekan Run. Jagra memasang APK debug terbaru di emulator atau ponsel USB, menjalankan flow [Maestro](https://maestro.dev) yang sudah Anda simpan satu per satu, lalu menunjukkan mana yang lolos, mana yang gagal, dan screenshot di titik gagalnya.

Flow ditulis dalam YAML Maestro biasa dan disimpan di folder `.jagra` di dalam repository aplikasi Anda, jadi tim berbagi flow lewat git dan flow tetap bisa dijalankan dengan Maestro CLI biasa. Mockoon bersifat opsional. Agent coding yang sudah terpasang di komputer Anda, misalnya Claude Code, bisa membantu menulis flow, tetapi lolos atau gagal selalu diputuskan oleh Maestro.

## Agen AI dan aturan penyedia

Jagra bisa meminta agen coding yang sudah terpasang di komputer Anda, misalnya Claude Code, Codex, Gemini CLI, OpenCode atau Oh My Pi, untuk menulis flow. Jagra menjalankan program agen itu sendiri, sama seperti Anda menjalankannya di terminal, dan agen memakai login yang Anda atur di agen tersebut. Jagra tidak pernah meminta, membaca atau menyimpan login, token atau API key, dan Jagra sendiri tidak mengirim apa pun ke penyedia AI.

Untuk menulis flow, agen membaca kode proyek Anda dan mengirimnya ke penyedianya. Setiap penyedia punya aturan sendiri soal memakai agennya dari tool lain, dan aturan itu bisa berubah. Baca aturan terbaru penyedia Anda sebelum memakai agennya dengan Jagra, dan kalau ini proyek kantor, pastikan perusahaan Anda mengizinkan kodenya dikirim ke penyedia itu.

Agen hanya boleh menulis di `.jagra/flows`, dan Jagra memberi tahu Anda kalau agen mengubah file lain. Lolos atau gagal selalu diputuskan oleh Maestro.

## Status

Jagra belum siap dipakai. Belum ada yang bisa dipasang, dan repository ini baru berisi pengaturan proyek dan dokumen desain. Urutan pembangunannya ada di [`docs/plan.md`](docs/plan.md).

## Lisensi

[MIT](LICENSE), dibuat oleh Rifan Setiadi.
