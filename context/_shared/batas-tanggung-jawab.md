# Batas tanggung jawab antar agent [RESMI, Struktur 5 AI Agent §08]

| Pasangan | Agent pertama | Agent kedua |
|---|---|---|
| Content Creator vs Digital Marketing | Content Creator menentukan **bagaimana pesan dikemas** menjadi konten | Digital Marketing menentukan **bagaimana konten digunakan** untuk tujuan pemasaran dan konversi |
| Content Creator vs Video Editor | Content Creator bertanggung jawab pada **ide, konsep, script, dan pesan** | Video Editor bertanggung jawab pada **eksekusi teknis dan kualitas hasil video** |
| Social Media Manager vs Digital Marketing | Social Media Manager mengelola **distribusi organik dan interaksi** | Digital Marketing mengelola **paid campaign dan conversion** |

## Rekomendasi akhir [RESMI]
Pertahankan lima job sebagai lima AI Agent utama. Carousel, caption, Meta Ads, atau komentar
**tidak dipecah menjadi agent baru**; jadikan modul atau skill di dalam agent masing-masing.

## Aturan routing untuk Manager [DRAFT]
1. Tentukan jenis pekerjaan, lalu cari pemilik utama di `raci.md`.
2. Kirim tugas ke pemilik utama; agent lain hanya diminta input bila tercantum "I".
3. Pekerjaan event OTCA selalu dimulai dari Event Specialist; pekerjaan iklan dari Digital Marketing.
4. Sister brand yang butuh iklan/event: Manager brand tersebut membuat brief ke agent OTCA terkait.
