const CONFIG = {
  GEMINI_MODEL:    'gemini-2.5-flash', 
  TRIGGER_HOUR:    8,  
  LOOKBACK_DAYS:   1,
  MAX_EMAILS:      8,
  MAX_BODY_CHARS:  12500, 
  NOTIFY_EMAIL:    'naamanyap@gmail.com',
};



function generateBloombergBrief() {
  try {
    Logger.log('▶ Bloomberg Brief generation started…');

    const now       = new Date();
    const dateLabel = formatDate(now, 'MMMM d, yyyy');
    const hour      = now.getHours(); // Get current hour

    // 1. Fetch Bloomberg emails
    Logger.log('📬 Searching Gmail for Bloomberg emails…');
    const emailContent = fetchBloombergEmails();
    const hasEmails    = emailContent.trim().length > 100;
    Logger.log(hasEmails ? '✓ Found Bloomberg emails (' + emailContent.length + ' chars)' : '⚠ No emails found — generating empty state');

    // 2. Summarize with Gemini → structured digest JSON
    Logger.log('🤖 Calling Gemini API…');
    const digest = summarizeWithGemini(emailContent, hasEmails, dateLabel);
    Logger.log('✓ Digest generated with ' + (digest.sections || []).length + ' sections');

    // 3. Format and Send to Telegram
    Logger.log('📤 Sending Brief to Telegram…');
    sendBriefToTelegram(digest, dateLabel, hour);
    Logger.log('✅ Done! All messages sent to Telegram.');

  } catch (err) {
    Logger.log('❌ Error: ' + err.message);
    sendFailureAlert(err);
    throw err;
  }
}

function fetchBloombergEmails() {
  const tz      = Session.getScriptTimeZone();
  const cutoff  = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.LOOKBACK_DAYS);
  const afterStr = Utilities.formatDate(cutoff, tz, 'yyyy/MM/dd');

  const queries = [
    'from:bloomberg.com after:' + afterStr,
    'from:bloomberg.net after:' + afterStr,
    'from:newsletter.bloomberg.com after:' + afterStr,
    'subject:"Bloomberg" after:' + afterStr,
  ];

  const seenIds = {};
  let combined  = '';

  queries.forEach(function(q) {
    const threads = GmailApp.search(q, 0, CONFIG.MAX_EMAILS);
    threads.forEach(function(thread) {
      if (seenIds[thread.getId()]) return;
      seenIds[thread.getId()] = true;

      thread.getMessages().forEach(function(msg) {
        const subject = msg.getSubject();
        const body    = msg.getPlainBody().substring(0, CONFIG.MAX_BODY_CHARS);
        combined += '\n\n=== EMAIL ===\nSubject: ' + subject + '\n\n' + body + '\n';
      });
    });
  });

  return combined;
}

function summarizeWithGemini(emailContent, hasEmails, dateLabel) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties.');

  var systemPrompt =
    'You are a Bloomberg newsletter document-generation assistant. ' +
    'The user will provide full Bloomberg newsletter contents for today. ' +
    'Parse every story, market data point, policy impact, and key fact from each email and ' +
    'produce an ultra-comprehensive, detailed digest. Extract deep analytical context.\n' +
    'Return ONLY a valid JSON object matching the requested schema. No explanation, no markdown text wrap.\n\n' +
    'The JSON structure must match this EXACT format:\n' +
    '{\n' +
    '  "sections": [\n' +
    '    {\n' +
    '      "emoji": "🌅",\n' +
    '      "title": "MORNING BRIEFING — ASIA",\n' +
    '      "byline": "Sara Marley",\n' +
    '      "date": "Monday, May 12, 2026",\n' +
    '      "articles": [\n' +
    '        { "headline": "Headline Title Case With Core Metric", "body": "A granular, highly detailed 7-10 sentence briefing including precise numbers, targets, names, macro economic context, and regulatory consequences." }\n' +
    '      ]\n' +
    '    }\n' +
    '  ],\n' +
    '  "quickHits": [\n' +
    '    "China PPI rose 2.8% YoY — fastest since July 2022 — signalling deflation exit"\n' +
    '  ]\n' +
    '}\n\n' +
    'SECTIONS — include all that have content, in this preferred order:\n' +
    '  🌅  MORNING BRIEFING — ASIA        (byline: journalist name if available)\n' +
    '  🌅  MORNING BRIEFING — AMERICAS    (byline: journalist name if available)\n' +
    '  🌙  EVENING BRIEFING — ASIA        (byline: journalist name if available)\n' +
    '  🌙  EVENING BRIEFING — AMERICAS    (byline: journalist name if available)\n' +
    '  📈  MARKETS\n' +
    '  💻  TECHNOLOGY\n' +
    '  💰  MONEY STUFF\n' +
    '  ⚖️  BALANCE OF POWER\n' +
    '  📡  SURVEILLANCE\n' +
    '  🌿  ECONOMICS & GREEN\n' +
    '  🏛️  POLITICS & POLICY\n\n' +
    'RULES:\n' +
    '- articles per section: aim for 3-5 articles; never fewer than 2 if the section has content.\n' +
    '- article body: Provide an uncompromised deep dive of 5-8 analytical sentences. Include specific metrics, policy impacts, asset prices, and dates. Do not condense or skim over structural details.\n' +
    '- headlines: punchy Bloomberg-style title case; include key movements, ticker signs, or figures.\n' +
    '- quickHits: 8-13 sharp, highly specific data bullets. Every single bullet must explicitly contain numbers, percentages, or concrete event transformations.\n' +
    '- Do NOT fabricate or hallucinate numbers or events not present in the source emails.\n' +
    '- Preserve all significant stories — this is a comprehensive structural reference document.';

  var userMsg = hasEmails
    ? 'Today is ' + dateLabel + '. Summarize these Bloomberg emails into the ultra-detailed digest JSON:\n\n' + emailContent
    : 'No Bloomberg emails found for ' + dateLabel + '. Return an empty digest JSON structure with empty sections and quickHits arrays.';

  var payload = {
    contents: [{
      parts: [
        { text: systemPrompt + "\n\nUser Input Data:\n" + userMsg }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1
    }
  };

  var apiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + CONFIG.GEMINI_MODEL + ':generateContent?key=' + apiKey;

  var maxRetries = 5;
  var baseDelay = 2000; 
  var response, status;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    response = UrlFetchApp.fetch(apiEndpoint, {
      method:      'POST',
      contentType: 'application/json',
      payload:     JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    status = response.getResponseCode();

    if (status === 200) {
      break; 
    } 
    
    if ((status === 503 || status === 429) && attempt < maxRetries) {
      var delayTime = baseDelay * Math.pow(2, attempt);
      Logger.log('⚠️ Gemini server busy (HTTP ' + status + '). Retrying in ' + (delayTime / 1000) + 's... (Attempt ' + (attempt + 1) + '/' + maxRetries + ')');
      Utilities.sleep(delayTime);
    } else {
      throw new Error('Gemini API returned HTTP ' + status + ': ' + response.getContentText().substring(0, 300));
    }
  }

  var data = JSON.parse(response.getContentText());
  var rawText = "";
  
  if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
    rawText = data.candidates[0].content.parts[0].text;
  }
  
  if (!rawText) throw new Error('Gemini response was empty or structural parsing failed.');

  return JSON.parse(rawText.trim());
}

function sendBriefToTelegram(digest, dateLabel, hour) {
  const botToken = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  const chatId   = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
  
  if (!botToken || !chatId) throw new Error('Missing credentials.');

 
  const isMorningWindow = (hour < 14); 
  const schedule = {
    false: ["MORNING BRIEFING — AMERICAS", "EVENING BRIEFING — ASIA"],
    true: ["MORNING BRIEFING — ASIA", "EVENING BRIEFING — AMERICAS"]
  };

  const alwaysInclude = ["MARKETS", "TECHNOLOGY", "MONEY STUFF", "BALANCE OF POWER", "SURVEILLANCE", "ECONOMICS & GREEN", "POLITICS & POLICY"];
  
  const normalize = (str) => str.toUpperCase().trim().replace(/—/g, '-');
  const allowedSections = (schedule[isMorningWindow] || []).concat(alwaysInclude).map(normalize);

  sendTelegramMessage(botToken, chatId, `🍊 <b>BLOOMBERG | NEWSLETTER DIGEST</b>\n📅 <i>${dateLabel}</i>\n═══════════════════`);
  Utilities.sleep(1000); 

  if (digest.sections) {
    digest.sections.forEach(function(section) {
      if (!allowedSections.includes(normalize(section.title))) {
        Logger.log('Skipping section: ' + section.title);
        return;
      }
      if (!section.articles || section.articles.length === 0) return;

      const title  = escapeHtml(section.title);
      const byline = escapeHtml(section.byline || '');

      let sectionHeader = `${section.emoji || '▪️'} <b>${title}</b>\n <i>${byline}</i>\n─────────────────\n\n`;
      let currentMsg = sectionHeader;

      section.articles.forEach(function(article) {
        const headline = escapeHtml(article.headline || '');
        const body     = escapeHtml(article.body || '');
        let articleText = `🔹 <b>${headline}</b>\n${body}\n\n`;

        if (articleText.length > 4000) {
          if (currentMsg !== sectionHeader) {
            sendTelegramMessage(botToken, chatId, currentMsg);
            Utilities.sleep(1500);
          }
          splitIntoChunks(articleText, 4000).forEach(function(chunk) {
            sendTelegramMessage(botToken, chatId, chunk);
            Utilities.sleep(1500);
          });
          currentMsg = `${section.emoji || '▪️'} <b>${title} (Cont.)</b>\n─────────────────\n\n`;
          return;
        }

        if ((currentMsg + articleText).length > 4000) {
          sendTelegramMessage(botToken, chatId, currentMsg);
          Utilities.sleep(1500);
          currentMsg = `${section.emoji || '▪️'} <b>${title} (Cont.)</b>\n─────────────────\n\n` + articleText;
        } else {
          currentMsg += articleText;
        }
      });

      if (currentMsg !== sectionHeader) {
        sendTelegramMessage(botToken, chatId, currentMsg);
        Utilities.sleep(1500);
      }
    });
  }

  if (digest.quickHits && digest.quickHits.length > 0) {
    Logger.log('Processing ' + digest.quickHits.length + ' quick hits.');

    let hitsMsg = `⚡ <b>QUICK HITS</b>\n───────────────────\n`;

    digest.quickHits.forEach(function(hit, index) {
      Logger.log('Processing hit ' + (index + 1) + ': ' + hit.substring(0, 50) + '...');

      let hitLine = `• ${escapeHtml(hit)}\n\n`;

      if ((hitsMsg + hitLine).length > 4000) {
        sendTelegramMessage(botToken, chatId, hitsMsg);
        Utilities.sleep(1500);
        hitsMsg = `⚡ <b>QUICK HITS (Cont.)</b>\n───────────────────\n`;
      }
      hitsMsg += hitLine;
    });

    sendTelegramMessage(botToken, chatId, hitsMsg);
  } else {
    Logger.log('QuickHits array is empty or missing.');
  }
}

function sendTelegramMessage(botToken, chatId, text) {
  const url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();

  if (status !== 200) {
    throw new Error(`Telegram error (HTTP ${status}): ${response.getContentText()}`);
  }
}


function setupDailyTriggers() {
  removeDailyTriggers(); 

  // Morning Trigger
  ScriptApp.newTrigger('generateBloombergBrief')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .nearMinute(30)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  // Evening Trigger
  ScriptApp.newTrigger('generateBloombergBrief')
    .timeBased()
    .everyDays(1)
    .atHour(19)
    .nearMinute(30)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  Logger.log('✅ Both daily triggers systematically configured for 8:30 AM and 7:30 PM');
}

function removeDailyTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'generateBloombergBrief') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log('🛑 All daily triggers for generateBloombergBrief removed.');
}

function formatDate(date, pattern) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), pattern);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function splitIntoChunks(text, maxLen) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function sendFailureAlert(err) {
  const email = CONFIG.NOTIFY_EMAIL || '';
  if (!email) return;
  try {
    GmailApp.sendEmail(
      email,
      '⚠ Bloomberg Brief Generation Failed',
      'Error: ' + err.message + '\n\nCheck logs at https://script.google.com'
    );
  } catch(e) {
    Logger.log('Could not send alert email: ' + e.message);
  }
}

