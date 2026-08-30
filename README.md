# Bloomberg Newsletter Digest Bot

A Google Apps Script that reads, in this case, Bloomberg newsletters from your Gmail inbox, summarises them with the Gemini API, and delivers a formatted digest to Telegram twice a day.

Bloomberg's newsletters are long, and opening them individually from your inbox is unnecessarily tedious and inefficient. Thus, this condenses all the vital information into an automated message that is sent to you as many times as you want (you can tweak the scheduler). Furthermore, with the code being run on Google Apps Script, the script is being run on the cloud for free. 

---

## How it works

1. **Fetch** — searches Gmail for Bloomberg newsletters received in the last `LOOKBACK_DAYS`, deduplicates threads, and extracts plain-text bodies.
2. **Summarise** — sends the combined text to Gemini with a schema-constrained prompt, returning JSON with `sections` (each holding articles) and `quickHits`.
3. **Deliver** — filters sections by time of day (Asia vs Americas briefings), formats them as Telegram HTML, splits anything over Telegram's 4096-character message limit, and sends.
4. **Alert** — emails you the error and stops.

Two time-based triggers run it daily at 08:30 and 19:30 in the script's timezone.

---

### Prerequisites

- A Google account subscribed to at least one Bloomberg newsletter
- A [Gemini API key](https://aistudio.google.com/apikey)
- A Telegram bot token and chat ID

Set up

1. Create the Apps Script project

Go to [script.google.com](https://script.google.com), create a new project, and paste in the contents of `Code.gs`.

2. Create a Telegram bot

Message [@BotFather](https://t.me/BotFather), send `/newbot`, and follow the prompts to get a bot token. 

3. Add credentials

In the Apps Script editor, go to **Project Settings → Script Properties** and add:

| `GEMINI_API_KEY` | Your Gemini API key |
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `TELEGRAM_CHAT_ID` | Your chat ID |

4. Configure

Edit the `CONFIG` block at the top of `Code.gs`:

| Key | Default | 

| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `TRIGGER_HOUR` | `8` | Hour of the morning run |
| `LOOKBACK_DAYS` | `1` | 
| `MAX_EMAILS` | `8` |
| `MAX_BODY_CHARS` | `12500` | 
| `NOTIFY_EMAIL` | 

5. Schedule it

Run `setupDailyTriggers()` once from the editor. Authorise the Gmail, external-request, and script scopes when prompted. Run `removeDailyTriggers()` to unschedule.

To test immediately, run `generateBloombergBrief()` and watch the execution log.

---

## Limitations

- Gmail search relies on Bloomberg's current sender domains and subject lines; these change occasionally.
- Summary quality is bounded by what Gemini extracts. Treat it as a reading aid, not a source of record.
- Apps Script has a daily quota on `UrlFetchApp` calls and email reads. Well within limits at two runs a day.

---

## Project structure

```

├── Code.gs           # All script logic
├── appsscript.json   # Apps Script manifest
├── README.md
├── LICENSE
└── .gitignore
```

---

## A note on content

This script processes newsletters delivered to your own inbox and sends the summary to a private chat. It does not scrape, redistribute, or republish Bloomberg content. Bloomberg's newsletter content is theirs; keep the output to yourself.

---

## Licence

MIT — see [LICENSE](LICENSE).
