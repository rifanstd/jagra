# Jagra

[English](README.md)

Jagra adalah aplikasi desktop untuk Windows dan macOS yang menguji build Android sebelum diserahkan ke QA. Arahkan ke aplikasi Anda lalu tekan Run. Jagra memasang APK debug terbaru di emulator atau ponsel USB, menjalankan flow [Maestro](https://maestro.dev) yang sudah Anda simpan satu per satu, lalu menunjukkan mana yang lolos, mana yang gagal, dan screenshot di titik gagalnya.

Flow ditulis dalam YAML Maestro biasa dan disimpan di folder `.jagra` di dalam repository aplikasi Anda, jadi tim berbagi flow lewat git dan flow tetap bisa dijalankan dengan Maestro CLI biasa. Mockoon bersifat opsional. Agent coding yang sudah terpasang di komputer Anda, misalnya Claude Code, bisa membantu menulis flow, tetapi lolos atau gagal selalu diputuskan oleh Maestro.

## Status

Jagra belum siap dipakai. Belum ada yang bisa dipasang, dan repository ini baru berisi pengaturan proyek dan dokumen desain. Urutan pembangunannya ada di [`docs/plan.md`](docs/plan.md).

## Lisensi

[MIT](LICENSE), dibuat oleh Rifan Setiadi.
