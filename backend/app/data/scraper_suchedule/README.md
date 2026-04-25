# SUchedule Scraper

Sabancı Üniversitesi'nin BannerWeb sisteminden belirli bir dönemin tüm ders programını çeken ve `data.min.json` dosyasına yazan scraper.

## Kullanım

```bash
pip install -r requirements.txt
python scrape.py <term_code>
```

`term_code`: BannerWeb'deki dönem numarası — formatı `YYYYNN` (`01`=Güz, `02`=Bahar, `03`=Yaz).
Geçerli kodları görmek için: `https://suis.sabanciuniv.edu/prod/bwckschd.p_disp_dyn_sched`.
Örn. `202502` = Bahar 2025-2026.

Çıktı `backend/app/data/schedule_data/{term}.min.json` dosyasına yazılır
(`schedule_data/` dizini varsa). Aksi halde scraper kendi dizinine
`data.min.json` olarak yazar.

GitHub Actions cron'u (`.github/workflows/scrape-suchedule.yaml`) bu
scraper'ı her gün 00:00 UTC'de çalıştırır ve veri değiştiğinde otomatik PR açar.

## Ne Yapıyor?

1. **Ders kodlarını çeker** — BannerWeb'e dönem kodu göndererek o dönemde açık olan tüm departman kodlarını (CS, ME, EE...) alır.

2. **Ders programını çeker** — Departman kodlarını kullanarak tüm derslerin CRN, isim, seksiyonlar, gün/saat, derslik ve öğretim üyesi bilgilerini çeker.

3. **Veriyi normalize eder** — Ham HTML verisini compact bir formata dönüştürür:
   - Günler `M/T/W/R/F` → `0-6` index
   - Saatler → başlangıç slotu (0-10) ve süre (slot sayısı)
   - Derslikler ve öğretim üyeleri → ayrı listelerde tutulur, derslerin içinde sadece index kullanılır

4. **JSON dosyası yazar** — `data.min.json` olarak kaydeder.

## Çıktı Formatı

```json
{
  "courses": [
    {
      "name": "Introduction to Computer Science",
      "code": "CS201",
      "classes": [
        {
          "type": "",
          "sections": [
            {
              "crn": "10234",
              "group": "A",
              "instructors": 0,
              "schedule": [
                { "day": 0, "place": 3, "start": 1, "duration": 2 }
              ]
            }
          ]
        }
      ]
    }
  ],
  "instructors": ["Jane Doe", ...],
  "places": ["FENS G035", ...]
}
```

`instructors` ve `places` alanları lookup listesidir; derslerin içindeki değerler bu listelerin index numaralarıdır.

### Ders Tipi (`type`)

Ders kodunun son harfinden belirlenir:

| Harf | Anlam       |
|------|-------------|
| `L`  | Lab         |
| `R`  | Recitation  |
| `D`  | Discussion  |
| `N`  | —           |
| `S`  | —           |
| `E`  | —           |
| ` `  | Ana ders    |

## Bağımlılıklar

- `requests`
- `beautifulsoup4`
