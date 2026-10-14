
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Groq API 設定
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// 首頁
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 健康檢查：確認伺服器有啟動
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    provider: "Groq",
    configured: Boolean(GROQ_API_KEY)
  });
});

// 呼叫 Groq AI
async function askGroq(messages) {
  if (!GROQ_API_KEY) {
    throw new Error(
      "伺服器尚未設定 GROQ_API_KEY，請到 Render 的 Environment 設定。"
    );
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.7,
        max_completion_tokens: 1200
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Groq API error:", response.status, data);

    if (response.status === 401 || response.status === 403) {
      throw new Error("Groq API 金鑰或帳號權限有問題，請檢查 Render 設定。");
    }

    if (response.status === 429) {
      throw new Error("目前已達 Groq 使用限制，請稍後再試。");
    }

    throw new Error(
      data.error?.message || `Groq API 請求失敗（${response.status}）。`
    );
  }

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("AI 沒有產生文字，請稍後再試。");
  }

  return content.trim();
}

function getSystemPrompt(scenario, tone, level) {
  return `
你是一位專業的國小親師溝通情境模擬教練。
你要幫助教師練習和家長溝通，不是直接替教師解決所有問題。

【情境】${scenario}
【教師練習目標】${tone}
【家長情緒程度】${level}

規則：
1. 扮演真實的家長，以自然、生活化的繁體中文對話。
2. 家長的情緒、疑慮和反應要符合指定情境。
3. 每次只回覆一段適當長度的家長發言，不要一次寫完整劇本。
4. 不要代替教師回答，也不要跳出家長角色說教。
5. 隨著教師的回覆，合理地追問、補充疑慮或逐漸緩和情緒。
6. 情緒激動時可以表達不滿，但不要使用威脅或人身攻擊。
7. 不可自行捏造已經發生的校園事實。
8. 全程使用繁體中文。
`;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(item =>
      item &&
      ["parent", "teacher"].includes(item.role) &&
      typeof item.content === "string"
    )
    .slice(-20)
    .map(item => ({
      // 家長的發言是 AI assistant；老師的發言是 user
      role: item.role === "parent" ? "assistant" : "user",
      content: item.content.slice(0, 3000)
    }));
}

// 親師溝通模擬 API
app.post("/api/simulate", async (req, res) => {
  try {
    const body = req.body || {};
    const action = body.action;
    const scenario = String(body.scenario || "一般親師溝通情境").slice(0, 1000);
    const tone = String(body.tone || "理性溫和").slice(0, 100);
    const level = String(body.level || "一般").slice(0, 100);
    const history = normalizeHistory(body.history);

    const systemPrompt = getSystemPrompt(scenario, tone, level);

    if (action === "start") {
      const message = await askGroq([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "現在開始情境模擬。請以家長的身分說出第一段話，清楚表達你的疑慮，讓教師可以開始練習。"
        }
      ]);

      return res.json({ success: true, message });
    }

    if (action === "reply") {
      if (!history.length) {
        return res.status(400).json({
          error: "目前沒有對話紀錄，請重新開始情境。"
        });
      }

      const message = await askGroq([
        { role: "system", content: systemPrompt },
        ...history
      ]);

      return res.json({ success: true, message });
    }

    if (action === "analyze") {
      const transcript = history
        .map(item =>
          `${item.role === "teacher" ? "老師" : "家長"}：${item.content}`
        )
        .join("\n");

      if (!history.some(item => item.role === "teacher")) {
        return res.status(400).json({
          error: "請至少完成一次教師回覆，再進行分析。"
        });
      }

      const analysis = await askGroq([
        {
          role: "system",
          content: `
你是一位親師溝通培訓講師。
請針對以下教師與家長的模擬對話，以繁體中文提供具體、友善、可實際使用的回饋。

請依序分析：
一、同理與傾聽（25分）
二、表達清楚程度（25分）
三、專業界線與適切性（25分）
四、合作解決問題（25分）

每項給出分數和簡短理由，總分滿分100分。
接著提供：
【做得好的地方】
【可以改進的地方】
【建議回覆範例】
【下一次練習重點】

請根據實際對話評估，不要只給空泛稱讚。
若資訊不足，請明確指出，不要自行捏造事實。
`
        },
        {
          role: "user",
          content: `請分析以下模擬對話：\n\n${transcript}`
        }
      ]);

      return res.json({ success: true, analysis });
    }

    return res.status(400).json({
      error: "未知的操作，請重新整理頁面後再試。"
    });

  } catch (error) {
    console.error("Simulation API error:", error.message);

    return res.status(500).json({
      error: error.message || "AI 服務目前無法使用，請稍後再試。"
    });
  }
});

app.listen(PORT, () => {
  console.log("親師溝通情境模擬練習器已啟動。");
  console.log("AI 服務：Groq");
  console.log("模型：", GROQ_MODEL);
  console.log("API 金鑰是否設定：", Boolean(GROQ_API_KEY));
});
