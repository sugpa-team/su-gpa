# SUchedule Scraper

Sabancı Üniversitesi'nin BannerWeb sisteminden belirli bir dönemin tüm ders programını çeken ve `data.min.json` dosyasına yazan scraper.

## Kullanım

```bash
pip install -r requirements.txt
python scrape.py <term_code>
```

`term_code`: BannerWeb'deki dönem numarası (örn. `202420` için 2024 Bahar).

Çıktı olarak `data.min.json` dosyası oluşturulur.

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
