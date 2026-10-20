# קלפי נגישה — איתור קלפי נגישה מיוחדת לבחירות לכנסת ה־26

אתר ציבורי פשוט שמציג מקומות שוועדת הבחירות המרכזית הגדירה כ**קלפיות נגישות מיוחדות** בבחירות לכנסת ה־26 (27.10.2026). האתר זמין בעברית, בערבית, ברוסית ובאמהרית. אין בו הרשמה ואין בו איסוף פרטים אישיים: המשתמש בוחר יישוב, מקליד את שם הרחוב (עם השלמה אוטומטית מרשימת הרחובות הרשמית) ואפשר גם מספר בית. החיפוש מתבצע כולו בדפדפן, והכתובת לא נשלחת לשום שרת. האתר מציג מקום מוביל ועד שתי חלופות, וקישורי ניווט ב־Waze וב־Google Maps.

> האתר **אינו** מאמת שיוך לקלפי או זכאות אישית, ואינו מבטיח נגישות פיזית של הדרך והכניסה.

## מצב נוכחי (20.10.2026)

האתר החי: https://yanivr.github.io/kalpi-negisha/ (נפרס מ־GitHub Actions). אחרי כל פריסה, ה־job `verify-live` בודק את האתר החי: קבצי הנתונים, ארבע השפות וחיפושי רחוב אמיתיים. עותק נוסף מתארח כ־Artifact ב־claude.ai (`npx tsx scripts/build-artifact.ts`).


| רכיב | מצב |
| --- | --- |
| נתוני קלפיות | ✅ יובאו מקבצי ועדת הבחירות; 39/39 בדיקות שלמות עברו (ראו `docs/source-audit.md`) |
| כללי הצבעה | ✅ אומתו מול התדריך הרשמי של ועדת הבחירות לכנסת ה־26 (`docs/legal-rules.md`) |
| רענון אוטומטי | ⚠️ ה־workflow מוכן, אבל קישורי ההורדה הישירים טרם תועדו, ולכן כל ניסיון יומי יירשם כ"לא הושלם" |
| חיפוש לפי רחוב | ✅ מקומי לגמרי. רשימת הרחובות הרשמית כוללת 63,580 רחובות, ול־31,912 מהם יש מיקום מ־OpenStreetMap (ל־11,157 גם מספרי בתים). ראו `docs/source-audit.md` §8 |
| תרגומים | מלאים; לא נבדקו על ידי דוברי השפות (`docs/translation-review.md`) |
| נגישות | בדיקות אוטומטיות בארבע השפות עוברות; בדיקות קורא מסך ומשתמשים טרם בוצעו (`docs/accessibility-audit.md`) |

## הפעלה מקומית

דרישות: Node.js 22.

```bash
npm ci
STATE_DIR=state-seed npm run release   # בונה public/data מתוך ה-state
npm run dev                            # http://localhost:5173/he/
```

| פקודה | מה היא עושה |
| --- | --- |
| `npm test` | בדיקות לוגיקה, יבוא וצינור (Vitest) |
| `npm run test:e2e` | בדיקות דפדפן ונגישות (Playwright + axe) על נתונים **סינתטיים** |
| `npm run typecheck` | בדיקת TypeScript |
| `npm run ingest:files -- --stations … --report104 … --concentrations … --report137 …` | יבוא ידני של הקבצים הרשמיים |
| `npm run rules:approve -- --excerpt … --start … --end … --reviewer …` | אישור אנושי של נוסח הכללים מול המקור הרשמי |
| `npm run refresh` | ניסיון רענון ממקורות רשמיים (רץ ב־Actions) |
| `npm run release` | בונה manifest ו־dataset תואמים לתוך `public/data` |
| `npm run build` | בונה את האתר הסטטי לתוך `dist` |

## פריסה ל־GitHub Pages

1. צרו מאגר ציבורי והעלו את הקוד (ענף `main`).
2. ב־Settings → Pages בחרו **Source: GitHub Actions**.
3. ה־workflow `build-geo` בונה את אינדקס הרחובות מ־OpenStreetMap ומפרסם אותו לענף `geo-index`. הוא רץ פעם בשבוע ובכל שינוי בקוד ההתאמה.
4. ה־workflow `refresh-and-deploy` ירוץ בכל push ופעמיים ביום (03:17 ו־15:47 UTC). בריצה הראשונה הוא יוצר את ענף `data-state` מתוך `state-seed/`.

### מבנה הנתונים בזמן ריצה

```
config/            election.json, source-registry.json, rules.json, contact.json
scripts/           ingest / refresh / build-release / approve-rules / build-pages / check-bundle
state-seed/        מצב התחלתי (dataset נגזר + state.json)
data-state (ענף)   מצב מתמשך בין ריצות; לא נשען על Actions cache
geo-index (ענף)    אינדקס רחובות שנבנה מ־OSM (build-geo.yml)
public/data/       נבנה בכל פריסה: manifest.json + dataset-<hash>.json + rules.json + report.json + geo.json + geo/<סמל יישוב>.json
```

הדפדפן טוען את `manifest.json`, מוריד את `dataset-<hash>.json`, ובודק שה־SHA-256 שלו זהה לזה שב־manifest. בכל טעינה, בחזרה לעמוד, לפני הצגת תוצאות ולפני פתיחת ניווט, הוא בודק את המצב: חסום, הסתיים או תקין. בשעה 22:00 ב־27.10.2026 (שעון ישראל) האתר עובר למצב ארכיון גם בלי פריסה חדשה.

## החלטות בעל המוצר (20.10.2026)

- **אין תפוגה מבוססת זמן**. מתבצע ניסיון רענון יומי בלבד (`config/election.json` → `freshness.policy: "no-expiry"`). שינוי שזוהה במקור הרשמי, או כלל שהשתנה, עדיין חוסם את ההצגה. אפשר לחזור למדיניות TTL של האפיון (26 שעות, ו־3 שעות ביום הבחירות) על ידי שינוי ל־`"ttl"`.
- **התרגום** באחריות המפתח, ללא בודק אנושי.
- **בתי אבות ומוסדות שיקומיים** לא מוצגים כל עוד אין אישור שהם פתוחים לציבור. אפשר לשנות זאת ב־`RESTRICTED_PLACE_TYPES` ב־`scripts/sources/cec-k26.ts`.

## פרטיות, רישיון, נגישות

- פרטיות: `docs/privacy.md`
- רישיון קוד: MIT (`LICENSE`); נתונים: `DATA-LICENSE.md`
- נגישות: `docs/accessibility-audit.md`; פניות: yaniv247@gmail.com, 054-3077100

## אבטחה

- תלויות האפליקציה בדפדפן: react, react-dom, zod ופונטים. אין קוד צד שלישי בזמן ריצה.
- `npm audit` מדווח על חולשה בינונית ב־`uuid` דרך `exceljs`. זו תלות פיתוח בלבד, שמשמשת לקריאת הקבצים הרשמיים ב־CI. הנתיב הפגיע (v3/v5/v6 עם buffer) אינו בשימוש.
- Actions נעולים ל־commit SHA. הרשאות כתיבה ניתנות רק ל־job הרענון (ענף `data-state`) ול־job הפריסה (Pages).
