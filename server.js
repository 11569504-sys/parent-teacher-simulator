
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Groq API 設定
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// 網頁首頁
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 檢查伺服器與 API 金鑰設定
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
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.7,
        max_completion_tokens: 1600
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

// 親師溝通情境設定
function getSystemPrompt(scenario, tone, level) {
  return `
你是一位專業的國小親師溝通情境模擬教練。
你要幫助教師練習與家長溝通。

【情境】
${scenario}

【教師練習目標】
${tone}

【家長情緒程度】
${level}

請遵守以下規則：
1. 扮演真實家長，以自然、生活化的繁體中文對話。
2. 家長的情緒、疑慮與反應必須符合指定情境。
3. 每次只回覆一段適當長度的家長發言。
4. 不要代替教師回答，也不要跳出角色說教。
5. 根據教師的回覆，合理地追問、補充疑慮或逐漸緩和情緒。
6. 情緒激動時可以表達不滿，但不可使用威脅或人身攻擊。
7. 不可捏造已發生的校園事實。
8. 全程使用繁體中文。
`;
}

// 統一處理對話紀錄
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(item =>
      item &&
      ["parent", "teacher", "user", "assistant"].includes(item.role) &&
      typeof item.content === "string" &&
      item.content.trim() !== ""
    )
    .slice(-30)
    .map(item => {
      // 不論前端傳 teacher/parent 或 user/assistant，
      // 都轉換成 Groq API 可用的角色。
      const isTeacher =
        item.role === "teacher" || item.role === "user";

      return {
        role: isTeacher ? "user" : "assistant",
        content: item.content.slice(0, 3000)
      };
    });
}

// 主 API：開始情境、教師回覆、分析對話
app.post("/api/simulate", async (req, res) => {
  try {
    const body = req.body || {};

    const action = body.action;
    const scenario = String(
      body.scenario || "一般親師溝通情境"
    ).slice(0, 1000);

    const tone = String(
      body.tone || "理性溫和"
    ).slice(0, 100);

    const level = String(
      body.level || "一般"
    ).slice(0, 100);

    const rawHistory = Array.isArray(body.history)
      ? body.history
      : [];

    const systemPrompt = getSystemPrompt(
      scenario,
      tone,
      level
    );

    // 開始情境：AI 扮演家長發言
    if (action === "start") {
      const message = await askGroq([
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content:
            "請開始情境模擬。你現在是家長，請說出第一段話，讓教師開始練習。"
        }
      ]);

      return res.json({
        success: true,
        message
      });
    }

    // 教師回覆後：AI 繼續扮演家長
    if (action === "reply") {
      const history = normalizeHistory(rawHistory);

      const hasTeacherReply = rawHistory.some(item =>
        item &&
        ["teacher", "user"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim() !== ""
      );

      if (!hasTeacherReply) {
        return res.status(400).json({
          error: "請先輸入教師回覆，再繼續情境。"
        });
      }

      const message = await askGroq([
        {
          role: "system",
          content: systemPrompt
        },
        ...history
      ]);

      return res.json({
        success: true,
        message
      });
    }

    // 分析對話：修正角色判斷，避免教師已回答卻無法分析
    if (action === "analyze") {
      const teacherMessages = rawHistory.filter(item =>
        item &&
        ["teacher", "user"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim() !== ""
      );

      if (teacherMessages.length === 0) {
        return res.status(400).json({
          error:
            "目前收到的對話紀錄中沒有辨識到教師回覆。請重新開始情境並再回答一次。"
        });
      }

      // 保留原始角色，避免分析時將老師與家長顛倒
      const transcript = rawHistory
        .filter(item =>
          item &&
          typeof item.content === "string" &&
          item.content.trim() !== ""
        )
        .map(item => {
          const roleName =
            ["teacher", "user"].includes(item.role)
              ? "老師"
              : "家長";

          return `${roleName}：${item.content}`;
        })
        .join("\n");

      const analysis = await askGroq([
        {
          role: "system",
          content: `
你是一位專業的親師溝通培訓講師。
請根據提供的實際對話，使用繁體中文進行具體、公平、友善的分析。

請依序提供：

一、同理與傾聽（25分）
評估教師是否理解家長的情緒與疑慮，並給出理由。

二、表達清楚程度（25分）
評估教師是否表達清楚、具體且容易理解。

三、專業界線與適切性（25分）
評估教師是否維持專業、尊重家長，並保護學生隱私。

四、合作解決問題（25分）
評估教師是否提出可行的下一步或合作方式。

請計算總分，滿分100分。

接著提供：
【做得好的地方】
【可以改進的地方】
【建議回覆範例】
【下一次練習重點】

請依照對話中的實際內容評估，不要只給空泛稱讚。
資訊不足時請明確指出，不可捏造事實。
`
        },
        {
          role: "user",
          content: `請分析以下親師溝通對話：\n\n${transcript}`
        }
      ]);

      return res.json({
        success: true,
        analysis
      });
    }

    return res.status(400).json({
      error: "未知的操作，請重新整理網頁後再試。"
    });

  } catch (error) {
    console.error(
      "Simulation API error:",
      error.message
    );

    return res.status(500).json({
      error:
        error.message ||
        "AI 服務目前無法使用，請稍後再試。"
    });
  }
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log("親師溝通情境模擬練習器已啟動。");
  console.log("AI 服務：Groq");
  console.log("模型：", GROQ_MODEL);
  console.log(
    "API 金鑰是否設定：",
    Boolean(GROQ_API_KEY)
  );
});
